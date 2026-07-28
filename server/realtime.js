// البث الفوري للإشعارات — Server-Sent Events لكل مستخدم
const clients = new Map(); // userId -> Set<res>

function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}

function removeClient(userId, res) {
  const set = clients.get(userId);
  if (set) {
    set.delete(res);
    if (!set.size) clients.delete(userId);
  }
}

// دفع إشعار فوري لمستخدم متصل (يتجاهل غير المتصلين بأمان)
function pushToUser(userId, payload) {
  const set = clients.get(Number(userId));
  if (!set) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch { set.delete(res); }
  }
}

// نبضة إبقاء الاتصال كل 25 ثانية
setInterval(() => {
  for (const set of clients.values())
    for (const res of set) { try { res.write(': ping\n\n'); } catch {} }
}, 25000);

module.exports = { addClient, removeClient, pushToUser };
