self.addEventListener("push", (event) => {
    const payload = event.data ? event.data.json() : {};
    const title = payload.title || "MIRX";

    event.waitUntil(
        self.registration.showNotification(title, {
            body: payload.body || "Новое событие в MIRX",
            icon: payload.icon || "/assets/icon.png",
            badge: payload.badge || "/assets/icon.png",
            tag: payload.tag || "mirx",
            requireInteraction: Boolean(payload.requireInteraction),
            data: {
                url: payload.url || "/",
            },
        })
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = event.notification.data?.url || "/";

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
            for (const client of clients) {
                if ("focus" in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }

            if (self.clients.openWindow) {
                return self.clients.openWindow(url);
            }

            return null;
        })
    );
});
