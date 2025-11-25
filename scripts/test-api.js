
const BASE_URL = 'http://localhost:3000/api/v1';

async function testEndpoint(name, url) {
    try {
        const res = await fetch(url);
        if (res.ok) {
            console.log(`✅ ${name}: OK (${res.status})`);
            return true;
        } else {
            console.error(`❌ ${name}: Failed (${res.status})`);
            return false;
        }
    } catch (error) {
        console.error(`❌ ${name}: Error (${error.message})`);
        return false;
    }
}

async function runTests() {
    console.log('Starting API tests...');

    // Wait for server to start and index to load
    console.log('Waiting for server and search index...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const tests = [
        { name: 'Health Check', url: `${BASE_URL}/health` },
        { name: 'Unified Conflict Data', url: `${BASE_URL}/unified/conflict` },
        { name: 'Unified Conflict Metadata', url: `${BASE_URL}/unified/conflict/metadata` },
        { name: 'Search (Basic)', url: `${BASE_URL}/search?q=gaza` },
        { name: 'Search (Fuzzy)', url: `${BASE_URL}/search?q=gza&fuzzy=0.4` },
        { name: 'Search (Category)', url: `${BASE_URL}/search?q=gaza&category=conflict` },
        { name: 'Documentation', url: 'http://localhost:3000/api-docs/' },
    ];

    let passed = 0;
    for (const test of tests) {
        if (await testEndpoint(test.name, test.url)) {
            passed++;
        }
    }

    console.log(`\nTests completed: ${passed}/${tests.length} passed.`);

    if (passed === tests.length) {
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runTests();
