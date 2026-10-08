const ordersList = document.getElementById("ordersList");
const orderSearch = document.getElementById("orderSearch");
const adminProducts = document.getElementById("adminProducts");
const productForm = document.getElementById("productForm");
const adminNavLinks = [...document.querySelectorAll("aside nav a")];
const orderStatuses = [
    "Payment verification pending",
    "Preparing",
    "Out for delivery",
    "Completed",
    "Cancelled"
];
let orders = [];
let products = [];
let editingProductId = "";

function setProductFormMode(product) {
    editingProductId = product ? product.id : "";
    document.getElementById("editingProductId").value = editingProductId;
    productForm.querySelector("h3").textContent = product ? "Edit product" : "Add a product";
    document.getElementById("saveProduct").textContent = product ? "Save product changes" : "Add product";
    document.getElementById("cancelProductEdit").hidden = !product;
    const imageInput = document.getElementById("productImage");
    imageInput.required = !product;
    imageInput.closest(".product-field").querySelector("label").textContent =
        product ? "Replace product photo (optional)" : "Product photo";
    imageInput.closest(".product-field").querySelector(".field-hint").textContent =
        product
            ? "Leave this empty to keep the current photo. JPEG, PNG, or WebP; maximum file size 1 MB."
            : "JPEG, PNG, or WebP; maximum file size 1 MB.";
}

function resetProductForm() {
    productForm.reset();
    setProductFormMode(null);
}

function updateAdminNavigation() {
    const currentHash = window.location.hash || "#dashboard";
    adminNavLinks.forEach(link => {
        const isCurrent = link.getAttribute("href") === currentHash;
        link.classList.toggle("active", isCurrent);
        if (isCurrent) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
    });
}

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

function renderOrders() {
    const validOrders = orders.filter(order => order && typeof order === "object");
    document.getElementById("totalOrders").textContent = validOrders.length.toLocaleString("en-PH");
    document.getElementById("pendingOrders").textContent = validOrders
        .filter(order => order.status === "Payment verification pending").length.toLocaleString("en-PH");
    const totalValue = validOrders.reduce((sum, order) => {
        const total = Number(order.total);
        return sum + (Number.isFinite(total) ? total : 0);
    }, 0);
    document.getElementById("orderValue").textContent = formatPrice(totalValue);

    const query = orderSearch.value.trim().toLowerCase();
    const visibleOrders = validOrders.filter(order => [
        order.order_number,
        order.name,
        order.phone,
        order.payment_reference
    ].some(value => String(value || "").toLowerCase().includes(query)));

    if (!visibleOrders.length) {
        ordersList.innerHTML = `<p class="empty-state">${query ? "No orders match your search." : "No orders yet. Orders placed through the shop will appear here."}</p>`;
        return;
    }

    ordersList.innerHTML = visibleOrders.map(order => {
        const items = Array.isArray(order.items) ? order.items : [];
        const itemList = items.length ? `<ul>${items.map(item => {
            const name = escapeHtml(item && item.name ? item.name : "Item");
            const quantity = Number(item && item.quantity);
            const safeQuantity = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
            const price = Number(item && item.price);
            const priceText = Number.isFinite(price) ? ` · ${formatPrice(price)} each` : "";
            return `<li>${name} × ${safeQuantity}${priceText}</li>`;
        }        ).join("")}</ul>` : "<p>Item details unavailable</p>";
        const status = orderStatuses.includes(order.status) ? order.status : "Payment verification pending";
        const statusOptions = orderStatuses.map(option =>
            `<option value="${option}"${option === status ? " selected" : ""}>${option}</option>`
        ).join("");
        const address = order.fulfilment === "Pickup" ? "Pickup in San Jose, Lipa City" :
            [order.fulfilment, order.address].filter(Boolean).map(escapeHtml).join(" · ");
        const pinnedLocation = formatDeliveryCoordinates(order.delivery_latitude, order.delivery_longitude);
        const reference = String(order.payment_reference || "").trim();
        const referenceClass = reference ? "payment-reference" : "payment-reference missing";

        return `
            <article class="order-card">
                <div class="order-card-header">
                    <div>
                        <h3>${escapeHtml(order.name || "Customer")}</h3>
                        <p class="order-date">${escapeHtml(order.order_number || "Order")} · ${escapeHtml(formatDate(order.created_at))}</p>
                    </div>
                    <span class="order-total">${formatPrice(order.total)}</span>
                </div>
                <div class="order-details">
                    <div><h4>Customer</h4><p>${escapeHtml(order.name || "Name not provided")}</p></div>
                    <div><h4>Mobile number</h4><p>${escapeHtml(order.phone || "No phone provided")}</p></div>
                    <div><h4>Fulfilment</h4><p>${address || "Delivery pin selected"}${pinnedLocation ? `<br>${escapeHtml(pinnedLocation)}` : ""}</p></div>
                    <div><h4>Requested date</h4><p>${escapeHtml(formatDeliveryDate(order.delivery_date))}</p></div>
                    <div><h4>Items</h4>${itemList}</div>
                    <div><h4>Payment reference</h4><p class="${referenceClass}">${reference ? escapeHtml(reference) : "Not provided"}</p></div>
                    <div><h4>Order status</h4><label class="visually-hidden" for="status-${escapeHtml(order.id)}">Update status for ${escapeHtml(order.order_number || "order")}</label>
                        <select class="status-select" id="status-${escapeHtml(order.id)}" data-order-id="${escapeHtml(order.id)}">${statusOptions}</select></div>
                    ${order.note ? `<div><h4>Customer note</h4><p>${escapeHtml(order.note)}</p></div>` : ""}
                </div>
                <div class="order-card-actions">
                    <button class="danger-button" type="button" data-delete-order="${escapeHtml(order.id)}">Delete order</button>
                </div>
            </article>`;
    }).join("");
}

function renderProducts() {
    if (!products.length) {
        adminProducts.innerHTML = '<p class="empty-state">No products are available yet. Add one using the form.</p>';
        return;
    }
    adminProducts.innerHTML = products.map(product => {
        const image = product.image.startsWith("/") ? product.image : `assets/images/${product.image}`;
        return `
            <article class="admin-product-card">
                <img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async">
                <h3>${escapeHtml(product.name)} · ${formatPrice(product.price)}</h3>
                <p>${escapeHtml(product.category)}${product.description ? ` · ${escapeHtml(product.description)}` : ""}</p>
                <div class="admin-product-actions">
                    <button class="refresh-button" type="button" data-edit-product="${escapeHtml(product.id)}">Edit product</button>
                    <button class="danger-button" type="button" data-delete-product="${escapeHtml(product.id)}">Delete product</button>
                </div>
            </article>`;
    }).join("");
}

async function loadProducts() {
    const refreshButton = document.getElementById("refreshProducts");
    refreshButton.disabled = true;
    try {
        products = await window.ajBloomApi.listProducts();
        renderProducts();
    } catch (error) {
        console.error("Could not load products.", error);
        adminProducts.innerHTML = '<p class="empty-state">Products couldn’t be loaded. Check your connection, then refresh.</p>';
    } finally {
        refreshButton.disabled = false;
    }
}

function readImageAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => {
            const result = String(reader.result || "");
            const separator = result.indexOf(",");
            if (separator < 0) {
                reject(new Error("The selected photo could not be read."));
                return;
            }
            resolve(result.slice(separator + 1));
        }, { once: true });
        reader.addEventListener("error", () => {
            reject(reader.error || new Error("The selected photo could not be read."));
        }, { once: true });
        reader.readAsDataURL(file);
    });
}

productForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!productForm.reportValidity()) return;
    const formData = new FormData(productForm);
    const image = formData.get("image");
    const message = document.getElementById("productMessage");
    const submitButton = document.getElementById("saveProduct");
    const hasImage = image instanceof File && image.size > 0;
    if (!editingProductId && !hasImage) {
        message.textContent = "Choose a product photo before saving.";
        return;
    }
    if (hasImage && !["image/jpeg", "image/png", "image/webp"].includes(image.type)) {
        message.textContent = "Choose a JPEG, PNG, or WebP photo.";
        return;
    }
    if (hasImage && image.size > 1024 * 1024) {
        message.textContent = "Product photos must be 1 MB or smaller.";
        return;
    }

    submitButton.disabled = true;
    message.textContent = editingProductId ? "Saving product changes…" : "Adding product…";
    try {
        const product = {
            name: String(formData.get("name")).trim(),
            price: Number(formData.get("price")),
            category: String(formData.get("category")),
            description: String(formData.get("description") || "").trim()
        };
        if (hasImage) {
            product.imageData = await readImageAsBase64(image);
            product.imageMimeType = image.type;
        }
        if (editingProductId) {
            await window.ajBloomApi.updateProduct(editingProductId, product);
            resetProductForm();
            message.textContent = "Product changes saved.";
        } else {
            await window.ajBloomApi.createProduct(product);
            resetProductForm();
            message.textContent = "Product added to the shop.";
        }
        await loadProducts();
    } catch (error) {
        console.error(editingProductId ? "Could not update product." : "Could not add product.", error);
        message.textContent = error.message || (editingProductId
            ? "The product couldn’t be updated. Please try again."
            : "The product couldn’t be added. Please try again.");
    } finally {
        submitButton.disabled = false;
    }
});

async function loadOrders() {
    const refreshButton = document.getElementById("refreshOrders");
    refreshButton.disabled = true;
    document.getElementById("pageMessage").textContent = "";
    try {
        orders = await window.ajBloomApi.listOrders();
        renderOrders();
    } catch (error) {
        console.error("Could not load orders.", error);
        document.getElementById("pageMessage").textContent = "Orders couldn’t be loaded. Check your connection, then refresh.";
    } finally {
        refreshButton.disabled = false;
    }
}

async function startAdminDashboard() {
    const account = await requireRole("admin");
    if (!account) return;
    const displayName = account.profile.full_name || account.session.user.email || "Admin";
    document.getElementById("adminGreeting").textContent = `Welcome, ${displayName}!`;
    document.getElementById("adminEmail").textContent = account.session.user.email || "";
    await Promise.all([loadOrders(), loadProducts()]);
}

document.getElementById("refreshOrders").addEventListener("click", loadOrders);
document.getElementById("refreshProducts").addEventListener("click", loadProducts);
document.getElementById("cancelProductEdit").addEventListener("click", resetProductForm);
window.addEventListener("hashchange", updateAdminNavigation);
updateAdminNavigation();
orderSearch.addEventListener("input", renderOrders);
adminProducts.addEventListener("click", async event => {
    const editButton = event.target.closest("[data-edit-product]");
    if (editButton) {
        const product = products.find(item => item.id === editButton.dataset.editProduct);
        if (!product) return;
        resetProductForm();
        setProductFormMode(product);
        productForm.elements.name.value = product.name;
        productForm.elements.price.value = product.price;
        productForm.elements.category.value = product.category;
        productForm.elements.description.value = product.description || "";
        document.getElementById("productMessage").textContent = "";
        productForm.scrollIntoView({ behavior: "smooth", block: "center" });
        productForm.elements.name.focus({ preventScroll: true });
        return;
    }
    const button = event.target.closest("[data-delete-product]");
    if (!button) return;
    const product = products.find(item => item.id === button.dataset.deleteProduct);
    if (!product || !window.confirm(`Delete “${product.name}” from the shop? Existing orders will keep their saved item details.`)) return;

    button.disabled = true;
    const message = document.getElementById("productMessage");
    message.textContent = "";
    try {
        await window.ajBloomApi.deleteProduct(product.id);
        message.textContent = "Product deleted from the shop.";
        await loadProducts();
    } catch (error) {
        console.error("Could not delete product.", error);
        message.textContent = error.message || "The product couldn’t be deleted. Please try again.";
        button.disabled = false;
    }
});
ordersList.addEventListener("change", async event => {
    const statusSelect = event.target.closest("[data-order-id]");
    if (!statusSelect) return;
    statusSelect.disabled = true;
    document.getElementById("pageMessage").textContent = "";
    const nextStatus = statusSelect.value;
    try {
        await window.ajBloomApi.updateOrderStatus(statusSelect.dataset.orderId, nextStatus);
    } catch (error) {
        console.error("Could not update order status.", error);
        await loadOrders();
        document.getElementById("pageMessage").textContent = "The order status wasn’t saved. Please try again.";
        return;
    } finally {
        statusSelect.disabled = false;
    }
    const updatedOrder = orders.find(order => order.id === statusSelect.dataset.orderId);
    if (updatedOrder) updatedOrder.status = nextStatus;
    renderOrders();
});
ordersList.addEventListener("click", async event => {
    const button = event.target.closest("[data-delete-order]");
    if (!button) return;
    const order = orders.find(item => item.id === button.dataset.deleteOrder);
    if (!order || !window.confirm(`Permanently delete order ${order.order_number || ""}? This cannot be undone.`)) return;

    button.disabled = true;
    document.getElementById("pageMessage").textContent = "";
    try {
        await window.ajBloomApi.deleteOrder(order.id);
        await loadOrders();
        document.getElementById("pageMessage").textContent = "Order deleted.";
    } catch (error) {
        console.error("Could not delete order.", error);
        document.getElementById("pageMessage").textContent = error.message || "The order couldn’t be deleted. Please try again.";
        button.disabled = false;
    }
});
document.getElementById("signOut").addEventListener("click", async () => {
    try {
        await signOutAndReturn();
    } catch (error) {
        document.getElementById("pageMessage").textContent = "Could not sign out. Please try again.";
    }
});

startAdminDashboard();
