async function getCurrentProfile() {
    const api = window.ajBloomApi;
    if (!api) throw new Error("The site could not load. Please refresh the page.");

    const { user, profile } = await api.me();
    if (!user || !profile) return null;
    return { session: { user }, profile };
}

function dashboardForRole(role) {
    return role === "admin" ? "admin.html" : "customer.html";
}

async function requireRole(allowedRole) {
    let account;
    try {
        account = await getCurrentProfile();
    } catch (error) {
        console.error("Could not load account access.", error);
        document.getElementById("pageMessage").textContent =
            "We couldn’t verify your account. Please check your connection and refresh.";
        return null;
    }

    if (!account) {
        window.location.replace(`login.html?role=${encodeURIComponent(allowedRole)}`);
        return null;
    }

    if (account.profile.role !== allowedRole) {
        window.location.replace(dashboardForRole(account.profile.role));
        return null;
    }
    return account;
}

async function signOutAndReturn() {
    try {
        await window.ajBloomApi.signOut();
    } catch (error) {
        console.error("Could not sign out.", error);
        throw error;
    }
    window.location.assign("account-type.html");
}
