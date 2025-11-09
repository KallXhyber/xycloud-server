// server.js (v2.0 - Versi Redis)

// Panggil "brankas" (dotenv) paling pertama
require('dotenv').config();

const fastify = require('fastify')({ logger: true });
const socketio = require('socket.io');
const Redis = require('ioredis'); // Panggil "sopir" Redis

// --- KONEKSI BUKU TAMU ABADI (REDIS) ---
// Dia otomatis nyari "REDIS_URL" dari file .env lu
const redis = new Redis(process.env.REDIS_URL);

redis.on('connect', () => {
  fastify.log.info('[Redis] Berhasil konek ke Buku Tamu Abadi!');
});
redis.on('error', (err) => {
  fastify.log.error(`[Redis] GAGAL KONEK: ${err.message}`);
  process.exit(1); // Kalo Redis gagal, matiin server. (Wajib)
});
// ----------------------------------------

fastify.register(require('@fastify/cors'), {
  origin: "*", 
});

const io = socketio(fastify.server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// --- DATABASE LAMA (Map) UDAH DIHAPUS ---
// const activeHosts = new Map(); <-- BYE BYE AMNESIA

// --- LOGIKA UTAMA SOCKET.IO (Versi Redis) ---

io.on('connection', (socket) => {
  fastify.log.info(`[Socket CONNECT] Ada yang nyambung, ID: ${socket.id}`);

  // =============================================
  // EVENT 1: HOST DAFTAR (dari .EXE)
  // =============================================
  socket.on('host-register', async ({ id, password }) => {
    // Kita pake 'host:' sebagai prefix biar rapi
    const hostKey = `host:${id}`;
    // Kita simpen 'socket:...' buat nyari pas disconnect
    const socketKey = `socket:${socket.id}`;
    
    try {
      // Cek ID-nya udah dipake belom di Redis
      const existing = await redis.exists(hostKey);
      
      if (existing) {
        fastify.log.warn(`[Host GAGAL] ID: ${id} udah dipake.`);
        socket.emit('host-register-failed', { message: 'ID sudah terpakai.' });
        return;
      }

      // Kalo aman, daftarin si Host ke Redis
      const hostData = JSON.stringify({
        socketId: socket.id,
        password: password,
      });
      
      // Simpen data Host-nya
      await redis.set(hostKey, hostData);
      // Simpen data "kebalikan" (Socket -> ID)
      await redis.set(socketKey, id);
      
      fastify.log.info(`[Host READY] ID: ${id} (Socket: ${socket.id}) berhasil online di Redis.`);
      socket.emit('host-register-success', { hostId: id });
      
    } catch (err) {
      fastify.log.error(`[Redis Error] Gagal register host: ${err.message}`);
      socket.emit('host-register-failed', { message: 'Server database error.' });
    }
  });

  // =============================================
  // EVENT 2: KLIEN MAU KONEK (dari Web/APK)
  // =============================================
  socket.on('client-request-connect', async ({ hostId, password }) => {
    fastify.log.info(`[Klien REQUEST] Klien ${socket.id} mau konek ke ${hostId}`);
    const hostKey = `host:${hostId}`;
    
    try {
      // 1. Cek Host-nya ada (online) apa enggak di Redis
      const data = await redis.get(hostKey);
      
      if (!data) {
        fastify.log.warn(`[Klien GAGAL] Host ${hostId} gak online (gak ada di Redis).`);
        socket.emit('client-connect-failed', { message: 'Host tidak ditemukan / offline.' });
        return;
      }

      // Kalo ada, 'data' itu masih string, kita parse
      const host = JSON.parse(data);

      // 2. Cek password-nya bener apa enggak
      if (host.password !== password) {
        fastify.log.warn(`[Klien GAGAL] Password salah untuk Host ${hostId}.`);
        socket.emit('client-connect-failed', { message: 'Password salah.' });
        return;
      }

      // 3. Kalo semua aman, bilang ke Host .EXE
      fastify.log.info(`[Klien MATCH] Klien ${socket.id} match sama Host ${hostId}. Mulai signaling...`);
      
      io.to(host.socketId).emit('client-wants-to-connect', {
        clientId: socket.id,
      });

      socket.emit('host-is-ready', {
        hostId: hostId,
        hostSocketId: host.socketId,
      });
      
    } catch (err) {
      fastify.log.error(`[Redis Error] Gagal konek klien: ${err.message}`);
      socket.emit('client-connect-failed', { message: 'Server database error.' });
    }
  });

  // =============================================
  // EVENT 3, 4, 5: "SURAT-SURATAN" WebRTC
  // Ini gak berubah, tetep gas
  // =============================================
  socket.on('webrtc-offer', ({ targetSocketId, sdp }) => {
    io.to(targetSocketId).emit('webrtc-offer', { senderSocketId: socket.id, sdp: sdp });
  });
  socket.on('webrtc-answer', ({ targetSocketId, sdp }) => {
    io.to(targetSocketId).emit('webrtc-answer', { senderSocketId: socket.id, sdp: sdp });
  });
  socket.on('webrtc-ice-candidate', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('webrtc-ice-candidate', { senderSocketId: socket.id, candidate: candidate });
  });

  // =============================================
  // EVENT 6: KALO ADA YANG PUTUS KONEKSI
  // =============================================
  socket.on('disconnect', async () => {
    fastify.log.info(`[Socket DISCONNECT] ${socket.id} putus koneksi.`);
    
    // Kita harus cek, yang putus ini Host bukan?
    // Kita pake data "kebalikan" yg kita simpen
    const socketKey = `socket:${socket.id}`;
    
    try {
      const hostId = await redis.get(socketKey);
      
      // Kalo 'hostId' ada, berarti bener dia Host
      if (hostId) {
        const hostKey = `host:${hostId}`;
        
        // Hapus data Host & data kebalikan dari Redis
        await redis.del(hostKey);
        await redis.del(socketKey);
        
        fastify.log.info(`[Host OFFLINE] Host ${hostId} (Socket: ${socket.id}) sekarang offline (dihapus dari Redis).`);
      }
      
    } catch (err) {
      fastify.log.error(`[Redis Error] Gagal pas disconnect: ${err.message}`);
    }
  });
});

// --- SURUH SERVERNYA JALAN ---
const start = async () => {
  try {
    const port = process.env.PORT || 3001;
    await fastify.listen({ port: port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
