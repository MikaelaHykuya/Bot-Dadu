require('dotenv').config();
const dns = require('dns').promises;
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function createAdminAccount() {
    let uri;
    try {
        // Resolve SRV secara manual untuk bypass Node.js DNS issue
        console.log('🔍 Resolving MongoDB SRV...');
        const srvRecords = await dns.resolveSrv('_mongodb._tcp.cluster0.u9ijiex.mongodb.net');
        const hosts = srvRecords.map(r => `${r.name}:${r.port}`).join(',');
        console.log('✅ Hosts ditemukan:', hosts);
        uri = `mongodb://alicezubberg_db_user:Raflyal21_@${hosts}/dadupro?ssl=true&authSource=admin&retryWrites=true&w=majority`;
    } catch (e) {
        console.log('⚠️  SRV gagal, pakai hardcode hosts...');
        uri = 'mongodb://alicezubberg_db_user:Raflyal21_@ac-dkrhjs1-shard-00-00.u9ijiex.mongodb.net:27017,ac-dkrhjs1-shard-00-01.u9ijiex.mongodb.net:27017,ac-dkrhjs1-shard-00-02.u9ijiex.mongodb.net:27017/dadupro?ssl=true&authSource=admin&retryWrites=true&w=majority';
    }

    const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 10000,
        tls: true,
        tlsAllowInvalidCertificates: false
    });

    try {
        console.log('🔌 Connecting ke MongoDB Atlas...');
        await client.connect();
        console.log('✅ Connected!');

        const db = client.db('dadupro');
        const users = db.collection('users');

        const email = 'Raflyal21_@gmail.com';
        const username = 'Alfzr7_';
        const password = 'Raflyal21_';

        // Hapus akun lama jika ada
        const deleted = await users.deleteOne({ $or: [{ email }, { username }] });
        if (deleted.deletedCount > 0) console.log('🗑  Akun lama dihapus');

        const user = {
            id: crypto.randomUUID(),
            username,
            email,
            password: bcrypt.hashSync(password, 10),
            tier: 'enterprise',
            subscribedAt: Date.now(),
            expiresAt: null, // permanent
            createdAt: Date.now()
        };

        await users.insertOne(user);
        console.log('\n✅ Akun berhasil dibuat!');
        console.log('   Username :', username);
        console.log('   Email    :', email);
        console.log('   Tier     : ENTERPRISE (permanent)');

    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.close();
    }
}

createAdminAccount();
