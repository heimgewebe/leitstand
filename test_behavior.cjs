
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_PATH = 'artifacts/insights.daily.json';
const PORT = 3000;

function runServer() {
  const server = spawn('node', ['dist/server.js'], {
    stdio: 'ignore', // ignore stdout/stderr to keep output clean, rely on http response
    detached: false
  });
  return server;
}

function makeRequest() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}/observatory`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('Starting tests...');
  let server;

  try {
    // Test 1: Missing Artifact -> Fallback
    console.log('\nTest 1: Missing Artifact');
    if (fs.existsSync(ARTIFACT_PATH)) fs.unlinkSync(ARTIFACT_PATH);
    server = runServer();
    await wait(2000);
    let res = await makeRequest();
    console.log(`Status: ${res.statusCode}`);
    if (res.body.includes('Fixture (Fallback)')) console.log('PASS: Shows Fixture (Fallback)');
    else console.log('FAIL: Did not show Fixture (Fallback)');
    server.kill();
    await wait(1000);

    // Test 2: Valid Artifact -> Live
    console.log('\nTest 2: Valid Artifact');
    fs.copyFileSync('src/fixtures/observatory.json', ARTIFACT_PATH);
    server = runServer();
    await wait(2000);
    res = await makeRequest();
    console.log(`Status: ${res.statusCode}`);
    if (res.body.includes('live artefakt')) console.log('PASS: Shows live artefakt');
    else console.log('FAIL: Did not show live artefakt');
    server.kill();
    await wait(1000);

    // Test 3: Invalid JSON -> 500
    console.log('\nTest 3: Invalid JSON');
    fs.writeFileSync(ARTIFACT_PATH, 'invalid json');
    server = runServer();
    await wait(2000);
    res = await makeRequest();
    console.log(`Status: ${res.statusCode}`);
    if (res.statusCode === 500) console.log('PASS: Returns 500');
    else console.log(`FAIL: Returned ${res.statusCode} (expected 500)`);
    server.kill();
    await wait(1000);

    // Test 4: Empty File -> 500 (JSON.parse fails on empty string)
    console.log('\nTest 4: Empty File');
    fs.writeFileSync(ARTIFACT_PATH, '');
    server = runServer();
    await wait(2000);
    res = await makeRequest();
    console.log(`Status: ${res.statusCode}`);
    if (res.statusCode === 500) console.log('PASS: Returns 500');
    else console.log(`FAIL: Returned ${res.statusCode} (expected 500)`);
    server.kill();
    await wait(1000);

  } catch (err) {
    console.error(err);
    if (server) server.kill();
  }
}

test();
