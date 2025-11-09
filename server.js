// server.js

// Import belanjaan kita
const fastify = require('fastify')({ logger: true });
const socketio = require('socket.io');

// Kita butuh CORS biar web/app bisa ngomong ke server ini
fastify.register(require('@fastify/cors'), {
  origin: "*", // Nanti ini diganti domain web lu kalo udah production
});

// Siapin Socket.IO, nempel di server Fastify
const io = socketio(fastify.server);

// --- DATABASE SEMENTARA ---
// Pake Map biar kenceng. Isinya nyimpen ID Host yg lagi online.
// Strukturnya: Map<hostId, { socketId: '...', password: '...' }>
const activeHosts = new Map();

// --- LOGIKA UTAMA SOCKET.IO DIMULAI DARI SINI ---

io.on('connection', (socket) => {
  fastify.log.info(`[Socket CONNECT] Ada yang nyambung, ID: ${socket.id}`);

  // =============================================
  // EVENT 1: HOST DAFTAR (dari .EXE)
  // =============================================
  socket.on('host-register', ({ id, password }) => {
    // Cek ID-nya udah dipake belom
    if (activeHosts.has(id)) {
      fastify.log.warn(`[Host GAGAL] ID: ${id} udah dipake.`);
      // Kirim balik error ke Host .EXE
      socket.emit('host-register-failed', { message: 'ID sudah terpakai.' });
      return;
    }

    // Kalo aman, daftarin si Host
    activeHosts.set(id, {
      socketId: socket.id,
      password: password,
    });

    fastify.log.info(`[Host READY] ID: ${id} (Socket: ${socket.id}) berhasil online.`);
    // Kirim balik sukses ke Host .EXE
    socket.emit('host-register-success', { hostId: id });
  });

  // =============================================
  // EVENT 2: KLIEN MAU KONEK (dari Web/APK)
  // =============================================
  socket.on('client-request-connect', ({ hostId, password }) => {
    fastify.log.info(`[Klien REQUEST] Klien ${socket.id} mau konek ke ${hostId}`);
    
    // 1. Cek Host-nya ada (online) apa enggak
    const host = activeHosts.get(hostId);
    if (!host) {
      fastify.log.warn(`[Klien GAGAL] Host ${hostId} gak online.`);
      socket.emit('client-connect-failed', { message: 'Host tidak ditemukan / offline.' });
      return;
    }

    // 2. Cek password-nya bener apa enggak
    if (host.password !== password) {
      fastify.log.warn(`[Klien GAGAL] Password salah untuk Host ${hostId}.`);
      socket.emit('client-connect-failed', { message: 'Password salah.' });
      return;
    }

    // 3. Kalo semua aman, bilang ke Host .EXE
    fastify.log.info(`[Klien MATCH] Klien ${socket.id} match sama Host ${hostId}. Mulai signaling...`);
    
    // Kirim ke Host .EXE, bilang "Woi, ada klien mau nyambung nih"
    io.to(host.socketId).emit('client-wants-to-connect', {
      clientId: socket.id, // Kasih tau ID si klien
    });

    // Kirim ke Klien, bilang "Oke, Host-nya udah siap"
    socket.emit('host-is-ready', {
      hostId: hostId,
      hostSocketId: host.socketId,
    });
  });

  // =============================================
  // EVENT 3, 4, 5: "SURAT-SURATAN" WebRTC
  // Ini bagian "Mak Comblang" P2P-nya
  // =============================================
  
  // Nganterin 'offer' (surat penawaran) dari satu pihak ke pihak lain
  socket.on('webrtc-offer', ({ targetSocketId, sdp }) => {
    fastify.log.info(`[WebRTC] Nganterin OFFER dari ${socket.id} ke ${targetSocketId}`);
    io.to(targetSocketId).emit('webrtc-offer', {
      senderSocketId: socket.id,
      sdp: sdp,
    });
  });

  // Nganterin 'answer' (surat balasan)
  socket.on('webrtc-answer', ({ targetSocketId, sdp }) => {
    fastify.log.info(`[WebRTC] Nganterin ANSWER dari ${socket.id} ke ${targetSocketId}`);
    io.to(targetSocketId).emit('webrtc-answer', {
      senderSocketId: socket.id,
      sdp: sdp,
    });
  });

  // Nganterin 'ice-candidate' (info alamat/rute)
  socket.on('webrtc-ice-candidate', ({ targetSocketId, candidate }) => {
    // fastify.log.info(`[WebRTC] Nganterin ICE dari ${socket.id} ke ${targetSocketId}`);
    io.to(targetSocketId).emit('webrtc-ice-candidate', {
      senderSocketId: socket.id,
      candidate: candidate,
    });
  });


  // =============================================
  // EVENT 6: KALO ADA YANG PUTUS KONEKSI
  // =============================================
  socket.on('disconnect', () => {
    fastify.log.info(`[Socket DISCONNECT] ${socket.id} putus koneksi.`);

    // Kita harus cek, yang putus ini Host bukan?
    // Kalo dia Host, kita harus apus dari daftar 'activeHosts'
    for (const [id, hostData] of activeHosts.entries()) {
      if (hostData.socketId === socket.id) {
        activeHosts.delete(id);
        fastify.log.info(`[Host OFFLINE] Host ${id} (Socket: ${socket.id}) sekarang offline.`);
        
        // (Opsional) Kasih tau klien lain yg mungkin lagi nyambung ke dia
        // ... (logika ini bisa ditambah nanti)
        break;
      }
    }
  });
});

// --- SURUH SERVERNYA JALAN ---
const start = async () => {
  try {
    // Port 3001 (atau bebas, asal jangan 3000 biar gak bentrok sama web)
    // Render.com bakal otomatis pake port dari environment
    const port = process.env.PORT || 3001;
    await fastify.listen({ port: port, host: '0.0.0.0' });
    fastify.log.info(`Server 'Mak Comblang' XYCLOUD jalan di port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();