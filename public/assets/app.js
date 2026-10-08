let products = [];
let productsLoaded = false;
let productLoadError = false;
const cartKey = "ajBloomCart";
const roleChoiceDismissedKey = "ajBloomRoleChoiceDismissed";
const maxItemQuantity = 99;
let activeCategory = "All";
let toastTimer;
let deliveryLocationMap = null;
let deliveryLocationMarker = null;
let hasSelectedDeliveryLocation = false;

function hasDismissedRoleChoice() {
    try {
        return localStorage.getItem(roleChoiceDismissedKey) === "true";
    } catch (error) {
        console.error("Could not read the role choice from browser storage.", error);
        return false;
    }
}

function dismissRoleChoice() {
    try {
        localStorage.setItem(roleChoiceDismissedKey, "true");
    } catch (error) {
        console.error("Could not save the role choice to browser storage.", error);
    }
    document.getElementById("roleChoiceBackdrop").hidden = true;
    document.body.classList.remove("no-scroll");
}

function formatPrice(amount) {
    return `₱${amount.toLocaleString("en-PH")}`;
}

function todayInManila() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());
}

function syncDeliveryMap() {
    const panel = document.getElementById("deliveryMapPanel");
    const isPickup = document.getElementById("fulfilment").value === "Pickup";
    if (isPickup) {
        panel.hidden = true;
        return;
    }

    panel.hidden = false;
    if (!window.L) {
        document.getElementById("deliveryMapMessage").textContent =
            "The map couldn’t load. Check your connection and refresh before placing your order.";
        return;
    }

    if (!deliveryLocationMap) {
        deliveryLocationMap = L.map("deliveryMap", { scrollWheelZoom: true })
            .setView([13.9416, 121.1631], 13);
        const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        });
        tiles.on("tileerror", () => {
            document.getElementById("deliveryMapMessage").textContent =
                "Map tiles couldn’t load. Check your connection and try again.";
        });
        tiles.addTo(deliveryLocationMap);
        deliveryLocationMap.on("click", event => selectDeliveryLocation(event.latlng));
    }
    requestAnimationFrame(() => deliveryLocationMap.invalidateSize());
}

function selectDeliveryLocation(location) {
    if (!deliveryLocationMap || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return;
    const coordinates = { lat: location.lat, lng: location.lng };
    if (!deliveryLocationMarker) {
        deliveryLocationMarker = L.marker(coordinates, { draggable: true }).addTo(deliveryLocationMap);
        deliveryLocationMarker.on("dragend", event => selectDeliveryLocation(event.target.getLatLng()));
    } else {
        deliveryLocationMarker.setLatLng(coordinates);
    }
    document.getElementById("deliveryLatitude").value = coordinates.lat.toFixed(6);
    document.getElementById("deliveryLongitude").value = coordinates.lng.toFixed(6);
    document.getElementById("deliveryMapMessage").textContent =
        `Delivery pin selected: ${coordinates.lat.toFixed(6)}, ${coordinates.lng.toFixed(6)}. Drag the pin to adjust it.`;
    hasSelectedDeliveryLocation = true;
}

function clearDeliveryLocation() {
    if (deliveryLocationMarker && deliveryLocationMap) {
        deliveryLocationMap.removeLayer(deliveryLocationMarker);
        deliveryLocationMarker = null;
    }
    hasSelectedDeliveryLocation = false;
    document.getElementById("deliveryLatitude").value = "";
    document.getElementById("deliveryLongitude").value = "";
    document.getElementById("deliveryMapMessage").textContent = "Select the exact delivery location on the map.";
    if (deliveryLocationMap) deliveryLocationMap.setView([13.9416, 121.1631], 13);
}

function formatOrderDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "Not selected";
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return "Not selected";
    return new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeZone: "Asia/Manila"
    }).format(date);
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

async function loadProducts() {
    try {
        if (!window.ajBloomApi) throw new Error("The product service is unavailable.");
        products = await window.ajBloomApi.listProducts();
        if (!Array.isArray(products)) throw new Error("The product service returned an invalid catalog.");
    } catch (error) {
        productLoadError = true;
        console.error("Could not load the product catalog.", error);
    }
    productsLoaded = true;
}

function readStoredList(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || "[]");
        if (!Array.isArray(value)) {
            throw new Error(`Stored ${key} data is not a list.`);
        }
        return value;
    } catch (error) {
        console.error(`Could not read ${key} from browser storage.`, error);
        return [];
    }
}

function saveStoredList(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error(`Could not save ${key} to browser storage.`, error);
        showToast("We couldn’t save that just now. Please try again.");
        return false;
    }
}

function getCart() {
    return readStoredList(cartKey).filter(item =>
        item && typeof item === "object" && !Array.isArray(item) &&
        products.some(product => product.id === item.id) &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0
    ).map(item => ({ id: item.id, quantity: Math.min(item.quantity, maxItemQuantity) }));
}

function renderProducts() {
    const search = document.getElementById("searchInput").value.trim().toLowerCase();
    const visibleProducts = products.filter(product =>
        (activeCategory === "All" || product.category === activeCategory) &&
        `${product.name} ${product.description}`.toLowerCase().includes(search)
    );
    const grid = document.getElementById("productGrid");
    document.getElementById("productCount").textContent =
        `${visibleProducts.length} ${visibleProducts.length === 1 ? "bouquet" : "bouquets"}`;

    if (!productsLoaded || productLoadError) {
        grid.innerHTML = `<p class="no-results">${productLoadError
            ? "We couldn’t load the flowers right now. Please refresh and try again."
            : "Loading flowers…"}</p>`;
        return;
    }

    if (!visibleProducts.length) {
        grid.innerHTML = '<p class="no-results">No blooms found just yet. Try another search.</p>';
        return;
    }

    grid.innerHTML = visibleProducts.map(product => `
        <article class="product-card">
            <div class="product-image">
                <img src="${escapeHtml(product.image.startsWith("/") ? product.image : `assets/images/${product.image}`)}" alt="${escapeHtml(product.name)} bouquet" loading="lazy" decoding="async">
                ${product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : ""}
            </div>
            <div class="product-meta"><h3>${escapeHtml(product.name)}</h3><span class="product-price">${formatPrice(product.price)}</span></div>
            <p class="product-description">${escapeHtml(product.description)}</p>
            <button class="button button-dark add-to-cart" type="button" data-add="${escapeHtml(product.id)}">Add to cart<span class="sr-only"> – ${escapeHtml(product.name)}</span></button>
        </article>
    `).join("");
}

function updateCartCount() {
    const count = getCart().reduce((total, item) => total + item.quantity, 0);
    document.getElementById("cartCount").textContent = count;
    document.getElementById("drawerCount").textContent = `(${count})`;
}

function addToCart(productId) {
    const product = products.find(item => item.id === productId);
    if (!product) return false;

    const cart = getCart();
    const existing = cart.find(item => item.id === productId);
    if (existing) {
        if (existing.quantity >= maxItemQuantity) {
            showToast("Each bouquet is limited to 99 per order.");
            return false;
        }
        existing.quantity += 1;
    } else {
        cart.push({ id: productId, quantity: 1 });
    }

    if (!saveStoredList(cartKey, cart)) return false;
    updateCartCount();
    showToast(`${product.name} added to cart`);
    return true;
}

function renderCart() {
    const cart = getCart();
    const cartItems = document.getElementById("cartItems");
    const footer = document.getElementById("cartFooter");
    updateCartCount();

    if (!cart.length) {
        cartItems.innerHTML = `
            <div class="empty-cart"><span class="empty-mark">✿</span>
                <strong>Your cart is waiting for a little joy.</strong>
                <p>Find a bouquet that feels just right.</p>
            </div>`;
        footer.replaceChildren();
        return;
    }

    let total = 0;
    cartItems.innerHTML = cart.map(item => {
        const product = products.find(entry => entry.id === item.id);
        const subtotal = product.price * item.quantity;
        total += subtotal;
        return `
            <article class="cart-row">
                <img src="${escapeHtml(product.image.startsWith("/") ? product.image : `assets/images/${product.image}`)}" alt="">
                <div><h3>${escapeHtml(product.name)}</h3><p>${formatPrice(product.price)} each</p>
                    <div class="quantity-controls">
                        <button type="button" data-quantity="-1" data-product="${escapeHtml(product.id)}" aria-label="Remove one ${escapeHtml(product.name)}">−</button>
                        <span>${item.quantity}</span>
                        <button type="button" data-quantity="1" data-product="${escapeHtml(product.id)}" aria-label="Add one ${escapeHtml(product.name)}">+</button>
                    </div>
                </div>
                <span class="cart-row-total">${formatPrice(subtotal)}</span>
            </article>`;
    }).join("");

    footer.innerHTML = `
        <div class="cart-subtotal"><span>Subtotal</span><span>${formatPrice(total)}</span></div>
        <p class="cart-shipping">Delivery details and fees are confirmed with you after checkout.</p>
        <button type="button" class="button button-dark" id="checkoutButton">Continue to checkout <span>↗</span></button>`;
}

function changeQuantity(productId, amount) {
    const cart = getCart();
    const item = cart.find(entry => entry.id === productId);
    if (!item) return;
    if (amount > 0 && item.quantity >= maxItemQuantity) {
        showToast("Each bouquet is limited to 99 per order.");
        return;
    }
    item.quantity += amount;
    const nextCart = cart.filter(entry => entry.quantity > 0);
    if (!saveStoredList(cartKey, nextCart)) return;
    renderCart();
}

function openCart() {
    renderCart();
    document.getElementById("cartOverlay").hidden = false;
    document.getElementById("cartDrawer").setAttribute("aria-hidden", "false");
    document.getElementById("cartDrawer").inert = false;
    document.body.classList.add("no-scroll");
    requestAnimationFrame(() => document.getElementById("cartDrawer").classList.add("open"));
    document.getElementById("closeCart").focus();
}

function closeCart() {
    const drawer = document.getElementById("cartDrawer");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    drawer.inert = true;
    document.getElementById("cartOverlay").hidden = true;
    document.body.classList.remove("no-scroll");
}

let checkoutOpener = null;

function openCheckout() {
    checkoutOpener = document.getElementById("openCart");
    const cart = getCart();
    if (!cart.length) return;
    const total = cart.reduce((sum, item) => {
        const product = products.find(entry => entry.id === item.id);
        return sum + product.price * item.quantity;
    }, 0);
    document.getElementById("checkoutTotal").textContent = formatPrice(total);
    document.getElementById("deliveryDate").min = todayInManila();
    document.getElementById("checkoutBackdrop").hidden = false;
    document.getElementById("guestSigninWarning").hidden = true;
    syncDeliveryMap();
    closeCart();
    document.body.classList.add("no-scroll");
    document.getElementById("customerName").focus();
}

function closeCheckout() {
    document.getElementById("checkoutBackdrop").hidden = true;
    document.body.classList.remove("no-scroll");
    if (checkoutOpener) checkoutOpener.focus();
}

function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2400);
}

function openReviewModal(src, alt) {
    const reviewImage = document.getElementById("reviewImage");
    reviewImage.src = src;
    reviewImage.alt = alt || "Customer review";
    document.getElementById("reviewBackdrop").hidden = false;
    document.body.classList.add("no-scroll");
}

function closeReviewModal() {
    document.getElementById("reviewBackdrop").hidden = true;
    document.body.classList.remove("no-scroll");
}

async function placeOrder(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const cart = getCart();
    if (!cart.length) {
        closeCheckout();
        showToast("Your cart is empty. Add a bouquet to get started.");
        return;
    }

    const api = window.ajBloomApi;
    if (!api) {
        showToast("Online ordering is unavailable. Please refresh and try again.");
        return;
    }
    let account;
    try {
        account = await getCurrentProfile();
    } catch (error) {
        console.error("Could not check the customer sign-in state.", error);
        showToast("We couldn’t connect to checkout. Please try again.");
        return;
    }
    if (!account) {
        document.getElementById("guestSigninWarning").hidden = false;
        document.getElementById("guestSigninWarning").scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
    }

    const formData = new FormData(form);
    const fulfilment = formData.get("fulfilment");
    const address = String(formData.get("address") || "").trim();
    const deliveryDate = String(formData.get("deliveryDate") || "");
    const deliveryLatitude = document.getElementById("deliveryLatitude").value;
    const deliveryLongitude = document.getElementById("deliveryLongitude").value;
    if (fulfilment !== "Pickup" && (!deliveryLatitude || !deliveryLongitude)) {
        document.getElementById("deliveryMapMessage").textContent =
            "Please click the map to pin the exact delivery location before placing your order.";
        return;
    }

    const items = cart.map(item => {
        const product = products.find(entry => entry.id === item.id);
        return { name: product.name, price: product.price, quantity: item.quantity };
    });
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const order = {
        id: `AJ-${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`,
        name: String(formData.get("name")).trim(),
        phone: String(formData.get("phone")).trim(),
        fulfilment,
        address: fulfilment === "Pickup" ? "" : address,
        deliveryDate,
        deliveryLatitude: fulfilment === "Pickup" ? null : deliveryLatitude,
        deliveryLongitude: fulfilment === "Pickup" ? null : deliveryLongitude,
        note: String(formData.get("note") || "").trim(),
        paymentReference: String(formData.get("paymentReference")).trim(),
        items,
        total,
        placedAt: new Date().toISOString()
    };

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    let cartWasCleared = false;
    try {
        if (!saveStoredList(cartKey, [])) return;
        cartWasCleared = true;

        const saved = await api.createOrder({
            name: order.name,
            phone: order.phone,
            fulfilment: order.fulfilment,
            address: order.address,
            deliveryDate: order.deliveryDate,
            deliveryLatitude: order.deliveryLatitude,
            deliveryLongitude: order.deliveryLongitude,
            note: order.note,
            paymentReference: order.paymentReference,
            items: cart.map(item => ({ id: item.id, quantity: item.quantity }))
        });
        order.id = saved.orderNumber;
    } catch (error) {
        if (cartWasCleared && !saveStoredList(cartKey, cart)) {
            console.error("The cart could not be restored after the order save failed.");
        }
        updateCartCount();
        console.error("Could not save the order.", error);
        showToast(error.code === "network_error"
            ? "We couldn’t reach the server. Check your connection and try again."
            : error.message || "We couldn’t save your order online. Please try again.");
        return;
    } finally {
        submitButton.disabled = false;
    }

    closeCheckout();
    form.reset();
    clearDeliveryLocation();
    updateCartCount();
    document.getElementById("successMessage").textContent =
        `Thanks, ${order.name}. We’ve saved your ${fulfilment.toLowerCase()} order for ${formatOrderDate(order.deliveryDate)} and will confirm the details with you directly.`;
    document.getElementById("orderReference").textContent = `YOUR ORDER · ${order.id}`;
    document.getElementById("successBackdrop").hidden = false;
    document.body.classList.add("no-scroll");
}

document.querySelectorAll(".filter-chip").forEach(button => {
    button.setAttribute("aria-pressed", String(button.classList.contains("active")));
    button.addEventListener("click", () => {
        activeCategory = button.dataset.category;
        const previous = document.querySelector(".filter-chip.active");
        previous.classList.remove("active");
        previous.setAttribute("aria-pressed", "false");
        button.classList.add("active");
        button.setAttribute("aria-pressed", "true");
        renderProducts();
    });
});

document.getElementById("productGrid").addEventListener("click", event => {
    const button = event.target.closest("[data-add]");
    if (!button || !addToCart(button.dataset.add)) return;
    const productName = products.find(item => item.id === button.dataset.add).name;
    button.innerHTML = `Added ✓<span class="sr-only"> – ${productName}</span>`;
    window.clearTimeout(button.resetTimer);
    button.resetTimer = window.setTimeout(() => {
        button.innerHTML = `Add to cart<span class="sr-only"> – ${productName}</span>`;
    }, 1400);
});

document.getElementById("cartItems").addEventListener("click", event => {
    const button = event.target.closest("[data-quantity]");
    if (button) changeQuantity(button.dataset.product, Number(button.dataset.quantity));
});

document.getElementById("searchInput").addEventListener("input", renderProducts);
document.getElementById("openCart").addEventListener("click", openCart);
document.getElementById("closeCart").addEventListener("click", closeCart);
document.getElementById("cartOverlay").addEventListener("click", closeCart);
document.getElementById("cartFooter").addEventListener("click", event => {
    if (event.target.closest("#checkoutButton")) openCheckout();
});
document.getElementById("closeCheckout").addEventListener("click", closeCheckout);
document.getElementById("checkoutForm").addEventListener("submit", placeOrder);
document.getElementById("fulfilment").addEventListener("change", event => {
    syncDeliveryMap();
});
document.getElementById("deliveryDate").min = todayInManila();
document.querySelectorAll(".story-review").forEach(image => {
    image.addEventListener("click", () => openReviewModal(image.src, image.alt));
});
document.getElementById("closeReview").addEventListener("click", closeReviewModal);
document.getElementById("reviewBackdrop").addEventListener("click", event => {
    if (event.target === event.currentTarget) closeReviewModal();
});
document.getElementById("continueShopping").addEventListener("click", () => {
    document.getElementById("successBackdrop").hidden = true;
    document.body.classList.remove("no-scroll");
});
document.getElementById("checkoutBackdrop").addEventListener("click", event => {
    if (event.target === event.currentTarget) closeCheckout();
});
document.getElementById("continueAsCustomer").addEventListener("click", () => {
    dismissRoleChoice();
});
document.getElementById("continueAsAdmin").addEventListener("click", dismissRoleChoice);
document.getElementById("successBackdrop").addEventListener("click", event => {
    if (event.target === event.currentTarget) {
        event.currentTarget.hidden = true;
        document.body.classList.remove("no-scroll");
    }
});
document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!document.getElementById("roleChoiceBackdrop").hidden) {
        dismissRoleChoice();
    } else if (!document.getElementById("reviewBackdrop").hidden) {
        closeReviewModal();
    } else if (!document.getElementById("successBackdrop").hidden) {
        document.getElementById("successBackdrop").hidden = true;
        document.body.classList.remove("no-scroll");
    } else if (!document.getElementById("checkoutBackdrop").hidden) {
        closeCheckout();
    } else if (document.getElementById("cartDrawer").classList.contains("open")) {
        closeCart();
        document.getElementById("openCart").focus();
    }
});

document.getElementById("year").textContent = new Date().getFullYear();
const checkoutRequested = new URLSearchParams(window.location.search).get("checkout") === "1";
if ((!checkoutRequested || !getCart().length) && !hasDismissedRoleChoice()) {
    document.getElementById("roleChoiceBackdrop").hidden = false;
    document.body.classList.add("no-scroll");
    document.getElementById("continueAsCustomer").focus();
}
renderProducts();
loadProducts().then(() => {
    renderProducts();
    updateCartCount();
    if (document.getElementById("cartDrawer").classList.contains("open")) renderCart();
    if (checkoutRequested) openCheckout();
});

// Keep the bag count correct when the cart changes in another tab.
window.addEventListener("storage", event => {
    if (event.key !== cartKey) return;
    updateCartCount();
    if (document.getElementById("cartDrawer").classList.contains("open")) renderCart();
});

// Keep keyboard focus inside whichever dialog is open.
document.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const openDialog = ["roleChoiceBackdrop", "reviewBackdrop", "successBackdrop", "checkoutBackdrop"]
        .map(id => document.getElementById(id))
        .find(element => element && !element.hidden)
        || (document.getElementById("cartDrawer").classList.contains("open") ? document.getElementById("cartDrawer") : null);
    if (!openDialog) return;
    const focusable = [...openDialog.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.disabled && !element.closest("[hidden]") && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
});
