const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8080';
const response = await fetch(`${base}/health`);
if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
console.log(await response.text());
