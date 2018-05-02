const https = require('https');

https.request('https://encrypted.google.com', res => {
  console.log(res);
});
