import test from 'node:test';
import assert from 'node:assert/strict';
import { FeishuChannel } from '../src/channels/feishu-channel.js';
import { WeChatChannel } from '../src/channels/wechat-channel.js';
import { DingTalkChannel } from '../src/channels/dingtalk-channel.js';
import { WeComChannel } from '../src/channels/wecom-channel.js';
import { QqChannel } from '../src/channels/qq-channel.js';

test('WeChatChannel segments text with code fences and strips markdown to plain', async () => {
  const sentPayloads = [];
  const wechat = new WeChatChannel({
    budget: 35, // Small budget for testing chunking
    senderFn: async (target, chunk) => {
      sentPayloads.push({ target, chunk });
      return { messageId: `wx_${sentPayloads.length}` };
    },
  });

  const markdownInput = '# System Notification\n\n```python\ndef run():\n    return 42\n```\n\nEnd of notification.';
  const result = await wechat.sendText('user_wx_1', markdownInput, 'markdown');

  assert.equal(result.sent, true);
  assert.ok(sentPayloads.length >= 2, 'Should split into multiple segments');
  assert.equal(sentPayloads[0].target, 'user_wx_1');

  // Verify markdown headers were stripped
  assert.doesNotMatch(sentPayloads[0].chunk, /^# /);
});

test('FeishuChannel formats markdown and delivers card/text payload', async () => {
  const sentPayloads = [];
  const feishu = new FeishuChannel({
    senderFn: async (target, payload) => {
      sentPayloads.push({ target, payload });
      return { messageId: 'fs_msg_1' };
    },
  });

  const result = await feishu.sendText('oc_group_123', '**Bold Announcement**', 'markdown');
  assert.equal(result.sent, true);
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].target, 'oc_group_123');
  assert.equal(sentPayloads[0].payload.msg_type, 'interactive');
});

test('DingTalkChannel supports markdown message delivery', async () => {
  const sentPayloads = [];
  const dingtalk = new DingTalkChannel({
    senderFn: async (target, payload) => {
      sentPayloads.push({ target, payload });
      return { messageId: 'dt_msg_1' };
    },
  });

  const result = await dingtalk.sendText('user_dt_123', '### DingTalk Alert\nServer ok.', 'markdown');
  assert.equal(result.sent, true);
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].payload.msgtype, 'markdown');
});

test('WeComChannel supports native markdown type', async () => {
  const sentPayloads = [];
  const wecom = new WeComChannel({
    senderFn: async (target, payload) => {
      sentPayloads.push({ target, payload });
      return { messageId: 'wecom_msg_1' };
    },
  });

  const result = await wecom.sendText('chat_wecom_abc', '> Quote alert\n**Finished**', 'markdown');
  assert.equal(result.sent, true);
  assert.equal(sentPayloads[0].payload.msgtype, 'markdown');
});

test('QqChannel supports OpenID target and markdown', async () => {
  const sentPayloads = [];
  const qq = new QqChannel({
    senderFn: async (target, payload) => {
      sentPayloads.push({ target, payload });
      return { messageId: 'qq_msg_1' };
    },
  });

  const result = await qq.sendText('openid_qq_789', 'QQ Bot report content', 'markdown');
  assert.equal(result.sent, true);
  assert.equal(sentPayloads[0].target, 'openid_qq_789');
  assert.equal(sentPayloads[0].payload.markdown, true);
});
