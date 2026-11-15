const test = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../server');

test('HTTP endpoints and teacher login API respond properly', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');

    const metaRes = await fetch(`${baseUrl}/api/meta`);
    assert.equal(metaRes.status, 200);
    const metaData = await metaRes.json();
    assert.equal(metaData.turretSlots.length, 4);
    assert.equal(metaData.waves.length, 8);

    const homeRes = await fetch(`${baseUrl}/`);
    assert.equal(homeRes.status, 200);
    const homeHtml = await homeRes.text();
    assert.ok(homeHtml.includes('AI 怪物塔防戰'));

    const teacherPageRes = await fetch(`${baseUrl}/teacher`);
    assert.equal(teacherPageRes.status, 200);
    const teacherHtml = await teacherPageRes.text();
    assert.ok(teacherHtml.includes('老師控制台'));

    const badLogin = await fetch(`${baseUrl}/api/teacher/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: 'wrong-pin' })
    });
    assert.equal(badLogin.status, 401);

    const goodLogin = await fetch(`${baseUrl}/api/teacher/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: process.env.TEACHER_PIN || '1234' })
    });
    assert.equal(goodLogin.status, 200);
    const loginData = await goodLogin.json();
    assert.equal(loginData.ok, true);
    assert.ok(loginData.token);

    const sioClientScript = await fetch(`${baseUrl}/socket.io/socket.io.js`);
    assert.equal(sioClientScript.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

