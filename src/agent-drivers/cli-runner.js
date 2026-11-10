import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * Universal CLI Agent runner that executes headless terminal tools
 * (Claude Code, Codex CLI, Pi CLI) with session resumption and stream event normalization.
 */
export class CliAgentRunner {
  constructor({ binary = 'claude', agentType = 'claude', defaultPermissionMode = 'dontAsk' } = {}) {
    this.binary = binary;
    this.agentType = agentType;
    this.defaultPermissionMode = defaultPermissionMode;
  }

  execute({
    prompt = '',
    cwd = process.cwd(),
    sessionId = null,
    model = null,
    permissionMode = null,
    timeoutMs = null,
    customArgs = null,
    images = [],
  }) {
    let args = [];

    if (Array.isArray(customArgs)) {
      args = [...customArgs];
    } else if (this.agentType === 'claude') {
      args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', permissionMode || this.defaultPermissionMode,
      ];
      if (sessionId) args.push('--resume', sessionId);
      if (model) args.push('--model', model);
    } else if (this.agentType === 'codex') {
      args = ['exec', '--json'];
      if (sessionId) args.push('resume', sessionId);
      if (model) args.push('--model', model);
    } else if (this.agentType === 'pi') {
      args = ['-p', '--mode', 'json'];
      if (sessionId) args.push('--session-id', sessionId);
      if (model) args.push('--model', model);
    } else {
      args = ['-p'];
      if (sessionId) args.push('--session', sessionId);
    }

    const isWin = process.platform === 'win32';
    const isExe = this.binary.toLowerCase().endsWith('.exe');
    const useShell = isWin && !isExe;

    const child = spawn(this.binary, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      windowsHide: true,
      shell: useShell,
      // POSIX 下让子进程成为新进程组组长，process.kill(-pid) 才能连同其派生的
      // 孙进程（shell 包装、agent 拉起的工具进程）一起终止；Windows 走 taskkill /T，无需 detached
      detached: !isWin,
    });

    let interrupted = false;
    let timedOut = false;
    let completedSessionId = sessionId;

    // 持续消费 stderr：既避免子进程写满 pipe 缓冲区后被阻塞，也保留尾部内容用于失败诊断
    let stderrTail = '';
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + chunk).slice(-4096);
      });
    }

    // 按进程树终止，而不是只杀直接子进程（否则 shell/agent 派生的孙进程会变孤儿并拖住 stdio）
    const killTree = (signal) => {
      if (!child.pid) return;
      if (isWin) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
          .on('error', () => {});
        return;
      }
      try {
        process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch {}
      }
    };

    // interrupt() 时 resolve：事件流不必等待进程 close 即可收尾，超时错误不会被存活的孙进程拖住
    let releaseInterruptWait;
    const interruptSignal = new Promise((resolve) => { releaseInterruptWait = resolve; });

    let timeoutTimer = null;

    const interrupt = () => {
      if (interrupted) return;
      interrupted = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);

      killTree('SIGTERM');
      // 优雅信号未生效时升级为强制终止
      const escalate = setTimeout(() => killTree('SIGKILL'), 800);
      escalate.unref?.();

      // 关闭全部事件源，立即解除 readline 迭代与 close 事件对 stdio 的依赖
      try { rl.close(); } catch {}
      try { child.stdout.destroy(); } catch {}
      try { child.stderr?.destroy(); } catch {}

      releaseInterruptWait();
    };

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (interrupted) return;
        timedOut = true;
        interrupt();
      }, timeoutMs);
    }

    // Send prompt via stdin and close
    if (child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

    const rl = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    const self = this;

    let settled = false;

    async function* eventStream() {
      try {
        for await (const line of rl) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed = null;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            // Non-JSON line from standard output
            yield { type: 'text', delta: line + '\n' };
            continue;
          }

          // Parse normalized event
          for (const evt of self.#normalizeStreamItem(parsed)) {
            if (evt.sessionId) {
              completedSessionId = evt.sessionId;
            }
            // 终态事件唯一化：首个 done/error 必须携带最新已知的 sessionId，
            // 后续终态直接丢弃，避免先到的不带会话信息的 done 挤占唯一终态位
            if (evt.type === 'done' || evt.type === 'error') {
              if (settled) continue;
              settled = true;
              if (evt.type === 'done') {
                evt.sessionId = evt.sessionId || completedSessionId;
              }
            }
            yield evt;
          }
        }

        // 正常路径等待 close 拿退出码；interrupt 后只保留短暂宽限让 close 事件落地，
        // 宽限耗尽即收尾上报，不再被未退出的孙进程阻塞
        const closed = child.exitCode !== null
          ? Promise.resolve(child.exitCode)
          : new Promise((resolve) => child.once('close', (code) => resolve(code)));
        const interruptGrace = interruptSignal.then(() => new Promise((resolve) => {
          const t = setTimeout(resolve, 250);
          t.unref?.();
        }));
        const exitCode = await Promise.race([closed, interruptGrace]);

        if (timeoutTimer) clearTimeout(timeoutTimer);

        // 流内已发过终态事件时，末尾兜底不再重复下发
        if (!settled) {
          if (timedOut) {
            yield {
              type: 'error',
              message: `Agent execution timed out after ${timeoutMs}ms`,
              terminationReason: 'timeout',
            };
          } else if (interrupted) {
            yield {
              type: 'done',
              sessionId: completedSessionId,
              terminationReason: 'interrupted',
            };
          } else if (exitCode === 0) {
            yield {
              type: 'done',
              sessionId: completedSessionId,
              terminationReason: 'normal',
            };
          } else {
            const detail = stderrTail.trim().split('\n').pop();
            yield {
              type: 'error',
              message: `Agent process exited with code ${exitCode}${detail ? `: ${detail}` : ''}`,
              terminationReason: 'failed',
            };
          }
        }
      } catch (err) {
        if (!settled) {
          settled = true;
          yield {
            type: 'error',
            message: err?.message || 'CLI execution error',
            terminationReason: interrupted ? 'interrupted' : 'failed',
          };
        }
      }
    }

    return {
      pid: child.pid,
      events: eventStream(),
      interrupt,
    };
  }

  *#normalizeStreamItem(raw) {
    if (!raw || typeof raw !== 'object') return;

    // 1. Pi CLI session event (first line emitted by pi --mode json)
    if (raw.type === 'session' && raw.id) {
      yield {
        type: 'system',
        sessionId: raw.id,
        cwd: raw.cwd,
      };
      return;
    }

    // 2. Claude/generic system initialization event
    if (raw.type === 'system') {
      yield {
        type: 'system',
        sessionId: raw.session_id || raw.sessionId,
        cwd: raw.cwd,
        model: raw.model,
      };
      return;
    }

    // 2. Assistant message / deltas
    if (raw.type === 'assistant' && raw.message?.content) {
      for (const block of raw.message.content) {
        if (block.type === 'thinking' && block.thinking) {
          yield { type: 'thinking', delta: block.thinking };
        } else if (block.type === 'text' && block.text) {
          yield { type: 'text', delta: block.text };
        } else if (block.type === 'tool_use') {
          yield {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
      }
      return;
    }

    // 3. User tool result event
    if (raw.type === 'user' && raw.message?.content) {
      for (const block of raw.message.content) {
        if (block.type === 'tool_result') {
          yield {
            type: 'tool_result',
            id: block.tool_use_id || block.id,
            output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            isError: Boolean(block.is_error),
          };
        }
      }
      return;
    }

    // 4. Pi CLI stream events (message_update with text_delta / thinking_delta)
    if (raw.type === 'message_update' && raw.assistantMessageEvent) {
      const sub = raw.assistantMessageEvent;
      if (sub.type === 'text_delta' && sub.delta) {
        yield { type: 'text', delta: sub.delta };
        return;
      }
      if (sub.type === 'thinking_delta' && sub.delta) {
        yield { type: 'thinking', delta: sub.delta };
        return;
      }
    }

    // Pi 的 turn_end 仅表示一轮输入处理完毕，且自身不携带 session_id，
    // 不作为终态（终态由 agent_settled 或进程退出兜底产生），
    // 避免它抢占唯一 done 位导致 sessionId 丢失
    if (raw.type === 'turn_end') {
      return;
    }

    if (raw.type === 'agent_settled') {
      yield {
        type: 'done',
        sessionId: raw.session_id || raw.sessionId,
        terminationReason: 'normal',
      };
      return;
    }

    // 5. Codex / generic json events
    if (raw.type === 'text' || raw.delta) {
      yield { type: 'text', delta: raw.delta || raw.text || '' };
      return;
    }

    if (raw.type === 'result') {
      yield {
        type: 'done',
        sessionId: raw.session_id || raw.sessionId,
        terminationReason: 'normal',
      };
    }
  }
}
