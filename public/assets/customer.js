const customerOrdersList = document.getElementById("ordersList");
let customerOrders = [];
let customerProducts = [];

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[character]);
}

function formatPrice(amount) {
    const price = Number(amount);
    return `₱${(Number.isFinite(price) ? price : 0).toLocaleString("en-PH")}`;
}

function formatDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
}

function formatDeliveryDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "Not selected";
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return "Not selected";
    return new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeZone: "Asia/Manila"
    }).format(date);
}

function formatDeliveryCoordinates(latitude, longitude) {
    if (latitude === null || longitude === null || latitude === undefined || longitude === undefined) return "";
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return "";
    return `Pinned location: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function productIdForOrderItem(item) {
    if (!item || typeof item !== "object") return "";
    const byId = customerProducts.find(product => product.id === item.id);
    if (byId) return byId.id;
    const bySnapshot = customerProducts.find(product =>
        product.name === item.name && Number(product.price) === Number(item.price));
    return bySnapshot ? bySnapshot.id : "";
}

function orderItemEditor(order, item) {
    const productId = productIdForOrderItem(item);
    const quantity = Number(item && item.quantity);
    const selectedQuantity = Number.isInteger(quantity) && quantity > 0 ? Math.min(quantity, 99) : 1;
    const productOptions = customerProducts.map(product =>
        `<option value="${escapeHtml(product.id)}"${product.id === productId ? " selected" : ""}>${escapeHtml(product.name)} · ${formatPrice(Number(product.price))}</option>`
    ).join("");
    return `
        <div class="customer-order-item-row">
            <label>
                Bouquet
                <select name="itemProduct" required>
                    <option value="">Choose a bouquet</option>${productOptions}
                </select>
            </label>
            <label>
                Quantity
                <input name="itemQuantity" type="number" min="1" max="99" step="1" value="${selectedQuantity}" required>
            </label>
            <button class="danger-button" type="button" data-remove-item aria-label="Remove bouquet">Remove</button>
        </div>`;
}

function orderEditForm(order, editableItems) {
    const fulfilment = ["Delivery", "Pickup", "Lalamove"].includes(order.fulfilment)
        ? order.fulfilment
        : "Delivery";
    const itemRows = editableItems
        ? order.items.map(item => orderItemEditor(order, item)).join("")
        : `<p class="page-message">This order contains a bouquet that is no longer available, so its details can’t be edited. You can still delete this unconfirmed order.</p>`;
    return `
        <details class="customer-order-edit">
            <summary>Edit order</summary>
            <form data-update-order="${escapeHtml(order.id)}">
                <label>Customer name<input name="name" type="text" value="${escapeHtml(order.name || "")}" maxlength="80" required></label>
                <label>Mobile number<input name="phone" type="tel" value="${escapeHtml(order.phone || "")}" maxlength="24" required></label>
                <label>Fulfilment
                    <select name="fulfilment" required>
                        <option value="Delivery"${fulfilment === "Delivery" ? " selected" : ""}>Delivery around Lipa City</option>
                        <option value="Pickup"${fulfilment === "Pickup" ? " selected" : ""}>Pickup in San Jose, Lipa City</option>
                        <option value="Lalamove"${fulfilment === "Lalamove" ? " selected" : ""}>Lalamove (outside Lipa City)</option>
                    </select>
                </label>
                <label>Delivery address
                    <input name="address" type="text" value="${escapeHtml(order.address || "")}" maxlength="300">
                </label>
                <div class="customer-order-coordinate-fields">
                    <label>Pin latitude<input name="deliveryLatitude" type="number" min="-90" max="90" step="any" value="${order.delivery_latitude ?? ""}"></label>
                    <label>Pin longitude<input name="deliveryLongitude" type="number" min="-180" max="180" step="any" value="${order.delivery_longitude ?? ""}"></label>
                </div>
                <label>Preferred delivery / pickup date
                    <input name="deliveryDate" type="date" min="${todayInManila()}" value="${escapeHtml(String(order.delivery_date || "").slice(0, 10))}" required>
                </label>
                <label>Payment reference
                    <input name="paymentReference" type="text" value="${escapeHtml(order.payment_reference || "")}" maxlength="80" required>
                </label>
                <label>Note <span>(optional)</span>
                    <textarea name="note" rows="2" maxlength="600">${escapeHtml(order.note || "")}</textarea>
                </label>
                <fieldset class="customer-order-items">
                    <legend>Bouquets and quantities</legend>
                    <div data-order-item-list>${itemRows}</div>
                    ${editableItems ? '<button class="refresh-button" type="button" data-add-item>Add another bouquet</button>' : ""}
                </fieldset>
                <p class="page-message" data-order-edit-message role="status"></p>
                ${editableItems ? '<button class="refresh-button" type="submit">Save order changes</button>' : ""}
            </form>
        </details>`;
}

function todayInManila() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());
}

function statusClass(status) {
    if (status === "Completed") return "completed";
    if (status === "Preparing") return "preparing";
    if (status === "Out for delivery") return "delivery";
    if (status === "Cancelled") return "cancelled";
    return "pending";
}

function renderCustomerOrders() {
    document.getElementById("customerOrderCount").textContent = customerOrders.length.toLocaleString("en-PH");
    document.getElementById("activeOrderCount").textContent = customerOrders
        .filter(order => !["Completed", "Cancelled"].includes(order.status)).length.toLocaleString("en-PH");
    document.getElementById("completedOrderCount").textContent = customerOrders
        .filter(order => order.status === "Completed").length.toLocaleString("en-PH");

    if (!customerOrders.length) {
        customerOrdersList.innerHTML = '<p class="empty-state">No signed-in customer orders yet. Orders placed while signed in will show up here.</p>';
        return;
    }

    customerOrdersList.innerHTML = customerOrders.map(order => {
        const items = Array.isArray(order.items) ? order.items : [];
        const itemList = items.length ? `<ul>${items.map(item => {
            const name = escapeHtml(item && item.name ? item.name : "Item");
            const quantity = Number(item && item.quantity);
            const safeQuantity = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
            return `<li>${name} × ${safeQuantity}</li>`;
        }).join("")}</ul>` : "<p>Item details unavailable</p>";
        const address = order.fulfilment === "Pickup" ? "Pickup in San Jose, Lipa City" :
            [order.fulfilment, order.address].filter(Boolean).map(escapeHtml).join(" · ");
        const pinnedLocation = formatDeliveryCoordinates(order.delivery_latitude, order.delivery_longitude);
        const awaitingAdmin = order.status === "Payment verification pending";
        const editableItems = items.length > 0 && items.every(item => productIdForOrderItem(item));

        return `
            <article class="order-card">
                <div class="order-card-header">
                    <div>
                        <h3>${escapeHtml(order.order_number || "Order")}</h3>
                        <p class="order-date">${escapeHtml(formatDate(order.created_at))}</p>
                    </div>
                    <span class="order-total">${formatPrice(order.total)}</span>
                </div>
                <div class="order-details">
                    <div><h4>Status</h4><span class="pill ${statusClass(order.status)}">${escapeHtml(order.status || "Payment verification pending")}</span></div>
                    <div><h4>Fulfilment</h4><p>${address || "Delivery pin selected"}${pinnedLocation ? `<br>${escapeHtml(pinnedLocation)}` : ""}</p></div>
                    <div><h4>Requested date</h4><p>${escapeHtml(formatDeliveryDate(order.delivery_date))}</p></div>
                    <div><h4>Items</h4>${itemList}</div>
                    ${order.note ? `<div><h4>Your note</h4><p>${escapeHtml(order.note)}</p></div>` : ""}
                </div>
                ${awaitingAdmin ? `
                    ${orderEditForm(order, editableItems)}
                    <div class="order-card-actions">
                        <button class="danger-button" type="button" data-delete-customer-order="${escapeHtml(order.id)}">Delete order</button>
                    </div>` : ""}
            </article>`;
    }).join("");
}

async function loadCustomerOrders() {
    const refreshButton = document.getElementById("refreshOrders");
    refreshButton.disabled = true;
    document.getElementById("pageMessage").textContent = "";
    try {
        const [listedOrders, listedProducts] = await Promise.all([
            window.ajBloomApi.listOrders(),
            window.ajBloomApi.listProducts().catch(error => {
                console.error("Could not load products for editing customer orders.", error);
                document.getElementById("pageMessage").textContent =
                    "Your orders loaded, but bouquets couldn’t be loaded for editing. Refresh and try again.";
                return [];
            })
        ]);
        customerOrders = listedOrders;
        customerProducts = listedProducts;
        renderCustomerOrders();
    } catch (error) {
        console.error("Could not load customer orders.", error);
        document.getElementById("pageMessage").textContent = "Your orders couldn’t be loaded. Check your connection, then refresh.";
    } finally {
        refreshButton.disabled = false;
    }
}

async function startCustomerDashboard() {
    const account = await requireRole("customer");
    if (!account) return;
    const fullName = String(account.profile.full_name || "").trim();
    const email = String(account.session.user.email || "").trim();
    const displayName = fullName || email || "there";
    document.getElementById("customerGreeting").textContent = `Hello, ${displayName}`;
    document.getElementById("customerEmail").textContent = "";
    document.getElementById("profileName").textContent = fullName || "Name not provided";
    document.getElementById("profileEmail").textContent = email || "Email unavailable";
    const initials = (fullName || email)
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part[0])
        .join("")
        .toUpperCase();
    document.getElementById("profileAvatar").textContent = initials || "✿";
    await loadCustomerOrders();
}

document.getElementById("refreshOrders").addEventListener("click", loadCustomerOrders);
customerOrdersList.addEventListener("click", async event => {
    const addButton = event.target.closest("[data-add-item]");
    if (addButton) {
        const details = addButton.closest(".customer-order-edit");
        const order = customerOrders.find(item => item.id === details.querySelector("[data-update-order]").dataset.updateOrder);
        if (!order || !customerProducts.length) return;
        const itemList = details.querySelector("[data-order-item-list]");
        itemList.insertAdjacentHTML("beforeend", orderItemEditor(order, { id: "", quantity: 1 }));
        return;
    }

    const removeButton = event.target.closest("[data-remove-item]");
    if (removeButton) {
        const itemList = removeButton.closest("[data-order-item-list]");
        if (itemList.querySelectorAll(".customer-order-item-row").length <= 1) {
            document.getElementById("pageMessage").textContent = "An order must contain at least one bouquet.";
            return;
        }
        removeButton.closest(".customer-order-item-row").remove();
        return;
    }

    const deleteButton = event.target.closest("[data-delete-customer-order]");
    if (!deleteButton) return;
    const order = customerOrders.find(item => item.id === deleteButton.dataset.deleteCustomerOrder);
    if (!order || !window.confirm(`Delete unconfirmed order ${order.order_number || ""}? This cannot be undone.`)) return;

    deleteButton.disabled = true;
    document.getElementById("pageMessage").textContent = "";
    try {
        await window.ajBloomApi.deleteOrder(order.id);
        await loadCustomerOrders();
        document.getElementById("pageMessage").textContent = "Your order was deleted.";
    } catch (error) {
        console.error("Could not delete customer order.", error);
        document.getElementById("pageMessage").textContent = error.message || "The order couldn’t be deleted. Please try again.";
        deleteButton.disabled = false;
    }
});

customerOrdersList.addEventListener("submit", async event => {
    const form = event.target.closest("[data-update-order]");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;

    const orderId = form.dataset.updateOrder;
    const order = customerOrders.find(item => item.id === orderId);
    if (!order) return;
    const formData = new FormData(form);
    const itemRows = [...form.querySelectorAll(".customer-order-item-row")];
    const items = itemRows.map(row => ({
        id: row.querySelector('[name="itemProduct"]').value,
        quantity: Number(row.querySelector('[name="itemQuantity"]').value)
    }));
    if (!items.length || items.some(item => !item.id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) {
        form.querySelector("[data-order-edit-message]").textContent = "Choose a bouquet and valid quantity for every item.";
        return;
    }

    const fulfilment = String(formData.get("fulfilment"));
    const submitButton = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[data-order-edit-message]");
    submitButton.disabled = true;
    message.textContent = "Saving your changes…";
    try {
        await window.ajBloomApi.updateOrder(orderId, {
            name: String(formData.get("name")).trim(),
            phone: String(formData.get("phone")).trim(),
            fulfilment,
            address: fulfilment === "Pickup" ? "" : String(formData.get("address") || "").trim(),
            deliveryDate: String(formData.get("deliveryDate")),
            deliveryLatitude: fulfilment === "Pickup" ? null : String(formData.get("deliveryLatitude") || ""),
            deliveryLongitude: fulfilment === "Pickup" ? null : String(formData.get("deliveryLongitude") || ""),
            paymentReference: String(formData.get("paymentReference")).trim(),
            note: String(formData.get("note") || "").trim(),
            items
        });
        await loadCustomerOrders();
        document.getElementById("pageMessage").textContent = "Your order changes were saved.";
    } catch (error) {
        console.error("Could not update customer order.", error);
        message.textContent = error.message || "Your changes couldn’t be saved. Please try again.";
        submitButton.disabled = false;
    }
});

document.getElementById("signOut").addEventListener("click", async () => {
    try {
        await signOutAndReturn();
    } catch (error) {
        document.getElementById("pageMessage").textContent = "Could not sign out. Please try again.";
    }
});

startCustomerDashboard();
