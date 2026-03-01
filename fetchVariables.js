const mysql = require('mysql2/promise');
async function run() {
    const conn = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: '' });
    const [rows] = await conn.query('SHOW COLUMNS FROM performance_schema.variables_info');
    console.log(rows);
    const [dbData] = await conn.query('SELECT * FROM performance_schema.variables_info LIMIT 20');
    console.log(dbData);
    process.exit(0);
}
run();
