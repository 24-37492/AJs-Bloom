const accountLink = document.getElementById("accountLink");
if (accountLink && window.ajBloomApi) {
    getCurrentProfile().then(account => {
        if (account) {
            accountLink.textContent = account.profile.role === "admin" ? "My dashboard" : "My orders";
            accountLink.href = dashboardForRole(account.profile.role);
        }
    }).catch(error => console.error("Could not load the signed-in account.", error));
}
