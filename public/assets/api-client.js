(function () {
    async function request(method, url, body) {
        let response;
        try {
            response = await fetch(url, {
                method,
                credentials: "same-origin",
                headers: body === undefined ? undefined : { "Content-Type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
        } catch (networkError) {
            const error = new Error("Failed to fetch");
            error.code = "network_error";
            throw error;
        }
        let data = null;
        try { data = await response.json(); } catch (parseError) { data = null; }
        if (!response.ok) {
            const details = data && data.error ? data.error : {};
            const error = new Error(details.message || "We couldn’t complete that request. Please try again.");
            error.code = details.code || "request_failed";
            error.status = response.status;
            throw error;
        }
        return data;
    }

    window.ajBloomApi = {
        me: () => request("GET", "/api/auth/me"),
        signUp: (email, password, fullName) => request("POST", "/api/auth/signup", { email, password, fullName }),
        verifyEmail: (email, code) => request("POST", "/api/auth/verify", { email, code }),
        resendCode: email => request("POST", "/api/auth/resend", { email }),
        signIn: (email, password) => request("POST", "/api/auth/signin", { email, password }),
        signOut: () => request("POST", "/api/auth/signout", {}),
        changePassword: newPassword => request("POST", "/api/auth/password", { newPassword }),
        listProducts: async () => (await request("GET", "/api/products")).products
            .sort((first, second) => Number(first.price) - Number(second.price)),
        createProduct: product => request("POST", "/api/products", product),
        updateProduct: (id, product) => request("PATCH", `/api/products/${encodeURIComponent(id)}`, product),
        deleteProduct: id => request("DELETE", `/api/products/${encodeURIComponent(id)}`, {}),
        createOrder: order => request("POST", "/api/orders", order),
        listOrders: async () => (await request("GET", "/api/orders")).orders,
        updateOrder: (id, order) => request("PATCH", `/api/orders/${encodeURIComponent(id)}`, order),
        updateOrderStatus: (id, status) => request("PATCH", `/api/orders/${encodeURIComponent(id)}/status`, { status }),
        deleteOrder: id => request("DELETE", `/api/orders/${encodeURIComponent(id)}`, {})
    };
})();
