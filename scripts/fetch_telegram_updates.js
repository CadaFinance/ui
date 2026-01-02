const https = require('https');

const token = '8571816408:AAGcIc4vV5JmUchd3mQSybN7iqPGZ0Nihjk'; // User Provided Token

https.get(`https://api.telegram.org/bot${token}/getUpdates`, (resp) => {
    let data = '';

    resp.on('data', (chunk) => {
        data += chunk;
    });

    resp.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log(JSON.stringify(json, null, 2));
        } catch (e) {
            console.error("Error parsing JSON:", e);
            console.log("Raw Data:", data);
        }
    });

}).on("error", (err) => {
    console.log("Error: " + err.message);
});
