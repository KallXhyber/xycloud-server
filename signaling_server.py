import asyncio
import aiohttp
from aiohttp import web
import json
import os

# Tempat untuk menyimpan 'host' dan 'viewer'
peers = {}

async def offer(request):
    """Menerima 'offer' dari satu peer dan meneruskannya ke peer lain."""
    params = await request.json()
    peer_id = params["id"]
    print(f"Menerima offer untuk peer {peer_id}")
    
    if peer_id not in peers:
        return web.Response(status=404, text="Peer tidak ditemukan")
        
    # Teruskan offer ke peer tujuan
    await peers[peer_id].send_str(json.dumps({
        "type": "offer",
        "sdp": params["sdp"]
    }))
    
    return web.Response(status=200)

async def answer(request):
    """Menerima 'answer' dan meneruskannya."""
    params = await request.json()
    peer_id = params["id"]
    print(f"Menerima answer untuk peer {peer_id}")
    
    if peer_id not in peers:
        return web.Response(status=404, text="Peer tidak ditemukan")
        
    # Teruskan answer ke peer tujuan
    await peers[peer_id].send_str(json.dumps({
        "type": "answer",
        "sdp": params["sdp"]
    }))
    
    return web.Response(status=200)

async def websocket_handler(request):
    """Menangani koneksi WebSocket dari 'host' dan 'viewer'."""
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    
    peer_id = None
    try:
        # Peer pertama kali terhubung, ambil ID-nya
        peer_id = request.query.get("id")
        if not peer_id or peer_id in peers:
            await ws.send_str(json.dumps({"type": "error", "message": "ID tidak valid atau sudah dipakai"}))
            await ws.close()
            return ws

        print(f"Peer {peer_id} terhubung.")
        peers[peer_id] = ws
        
        async for msg in ws:
            # Kita tidak proses pesan masuk di sini
            # karena 'offer'/'answer' dikirim via HTTP POST
            pass

    except Exception as e:
        print(f"Error WebSocket: {e}")
    finally:
        if peer_id and peer_id in peers:
            del peers[peer_id]
            print(f"Peer {peer_id} terputus.")
            
    return ws

# --- Bagian Penting untuk Render ---
app = web.Application()
app.router.add_post("/offer", offer)
app.router.add_post("/answer", answer)
app.router.add_get("/ws", websocket_handler)

# Render akan kasih tahu kita port berapa yang harus dipakai
port = int(os.environ.get("PORT", 8080))
print(f"Menjalankan Signaling Server di http://0.0.0.0:{port}")
web.run_app(app, host='0.0.0.0', port=port)