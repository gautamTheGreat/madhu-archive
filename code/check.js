const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./src/data/posts.json', 'utf8'));
const posts = Array.isArray(data) ? data : (data.posts || []);
console.log('Total posts:', posts.length);
if (posts.length > 0) {
  console.log('Keys:', Object.keys(posts[0]));
  const sizes = posts.map(p => JSON.stringify(p).length);
  const avg = sizes.reduce((a,b)=>a+b,0)/sizes.length;
  console.log('Avg size per post:', avg);
}
