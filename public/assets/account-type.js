const accountTypeMessage = document.getElementById("accountTypeMessage");

document.querySelectorAll("[data-account-role]").forEach(link => {
    link.addEventListener("click", async event => {
        event.preventDefault();
        if (link.getAttribute("aria-disabled") === "true") return;
        const selectedRole = link.dataset.accountRole;
        const signInUrl = `login.html?role=${encodeURIComponent(selectedRole)}`;
        link.setAttribute("aria-disabled", "true");
        accountTypeMessage.textContent = "";

        try {
            const { user, profile } = await window.ajBloomApi.me();
            if (user && profile && profile.role !== selectedRole) {
                await window.ajBloomApi.signOut();
                window.location.assign(signInUrl);
                return;
            }
            if (user && profile) {
                window.location.assign(profile.role === "admin" ? "admin.html" : "customer.html");
                return;
            }
            window.location.assign(signInUrl);
        } catch (error) {
            console.error("Could not switch the selected account type.", error);
            accountTypeMessage.textContent =
                "We couldn’t switch accounts right now. Please check your connection and try again.";
            link.removeAttribute("aria-disabled");
        }
    });
});
