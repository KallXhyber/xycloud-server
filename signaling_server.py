import asyncio
import aiohttp
from aiohttp import web
import json
import os

peers = {}

async def offer(request):
    params = await request.json()
    peer_id = params.get("id")
    if not peer_id or peer_id not in peers:
        return web.Response(status=404, text="Peer tidak ditemukan")
    print(f"Meneruskan 'offer' ke {peer_id}")
    await peers[peer_id]['ws'].send_json({"type": "offer", "sdp": params["sdp"]})
    return web.Response(status=200)

async def answer(request):
    params = await request.json()
    peer_id = params.get("id")
    if not peer_id or peer_id not in peers:
        return web.Response(status=404, text="Peer tidak ditemukan")
    print(f"Meneruskan 'answer' ke {peer_id}")
    await peers[peer_id]['ws'].send_json({"type": "answer", "sdp": params["sdp"]})
    return web.Response(status=200)

async def ice_candidate(request):
    params = await request.json()
    peer_id = params.get("id")
    if not peer_id or peer_id not in peers:
        return web.Response(status=404, text="Peer tidak ditemukan")
    await peers[peer_id]['ws'].send_json({
        "type": "ice-candidate",
        "candidate": params.get("candidate")
    })
    return web.Response(status=200)

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    
    peer_id = None
    try:
        msg = await ws.receive_json()
        peer_id = msg.get("id")
        action = msg.get("action")

        if action == "register_host":
            password = msg.get("password")
            if not peer_id or not password:
                await ws.send_json({"type": "error", "message": "ID/Password host tidak valid"})
                await ws.close()
                return ws
            if peer_id in peers:
                await ws.send_json({"type": "error", "message": "ID ini sudah dipakai"})
                await ws.close()
                return ws
            
            peers[peer_id] = {'ws': ws, 'password': password, 'type': 'host'}
            print(f"Host terdaftar: {peer_id}")
            await ws.send_json({"type": "success", "message": "Host berhasil terdaftar"})

        elif action == "join_viewer":
            host_id = msg.get("host_id")
            password = msg.get("password")
            
            if not host_id or host_id not in peers or peers[host_id]['type'] != 'host':
                await ws.send_json({"type": "error", "message": "ID Host tidak ditemukan"})
                await ws.close()
                return ws
            
            if peers[host_id]['password'] != password:
                await ws.send_json({"type": "error", "message": "Password salah"})
                await ws.close()
                return ws
            
            print(f"Viewer {peer_id} bergabung ke room {host_id}")
            peers[peer_id] = {'ws': ws, 'host_id': host_id, 'type': 'viewer'}
            await ws.send_json({"type": "success", "message": "Berhasil bergabung ke room"})
            await peers[host_id]['ws'].send_json({"type": "viewer_joined", "viewer_id": peer_id})
        
        else:
            await ws.close()
            return ws

        async for msg in ws:
            pass 

    except Exception as e:
        print(f"Error WebSocket: {e}")
    finally:
        if peer_id and peer_id in peers:
            print(f"Peer {peer_id} terputus.")
            del peers[peer_id]
            
    return ws

async def http_handler(request):
    """Menyajikan file viewer.html"""
    script_dir = os.path.dirname(__file__)
    html_file_path = os.path.join(script_dir, "viewer.html") # <-- Nama file yg benar
    
    try:
        with open(html_file_path, "r", encoding="utf-8") as f:
            html_content = f.read()
        return web.Response(text=html_content, content_type="text/html")
    except FileNotFoundError:
        return web.Response(status=404, text="File 'viewer.html' tidak ditemukan.")

app = web.Application()
app.router.add_get("/", http_handler)
app.router.add_get("/ws", websocket_handler)
app.router.add_post("/offer", offer)
app.router.add_post("/answer", answer)
app.router.add_post("/ice-candidate", ice_candidate)

port = int(os.environ.get("PORT", 8080))
print(f"Menjalankan Signaling Server (v2) di http://0.0.0.0:{port}")
web.run_app(app, host='0.0.0.0', port=port)
