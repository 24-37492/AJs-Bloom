const authForm = document.getElementById("authForm");
const fullNameInput = document.getElementById("fullName");
const fullNameLabel = document.getElementById("fullNameLabel");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const authMessage = document.getElementById("authMessage");
const submitAuthButton = document.getElementById("submitAuth");
const emailVerificationForm = document.getElementById("emailVerificationForm");
const emailVerificationCode = document.getElementById("emailVerificationCode");
const verifyEmailButton = document.getElementById("verifyEmail");
const resendEmailCodeButton = document.getElementById("resendEmailCode");
const authTabs = document.querySelector(".auth-tabs");
const confirmPasswordInput = document.getElementById("confirmPassword");
const confirmPasswordLabel = document.getElementById("confirmPasswordLabel");
const passwordHint = document.getElementById("passwordHint");
const togglePasswordButton = document.getElementById("togglePassword");
const requestedRole = new URLSearchParams(window.location.search).get("role");
const expectedRole = ["customer", "admin"].includes(requestedRole) ? requestedRole : "";
let authMode = expectedRole === "admin" ? "signin" : "signup";
let pendingVerificationEmail = "";
const returnToCheckout = new URLSearchParams(window.location.search).get("return") === "checkout";

function setAuthMode(mode) {
    authMode = mode;
    emailVerificationForm.hidden = true;
    authForm.hidden = false;
    authTabs.hidden = false;
    const signingUp = mode === "signup";
    const title = expectedRole === "admin"
        ? signingUp ? "Create admin account" : "Admin sign in"
        : expectedRole === "customer"
        ? signingUp ? "Create your customer account" : "Customer sign in"
        : signingUp ? "Create your account" : "Welcome back";
    document.getElementById("formTitle").textContent = title;
    document.querySelector(".auth-copy").textContent = expectedRole === "admin"
        ? "Create or sign in to the authorized admin account. Only the configured admin email can access the admin dashboard."
        : expectedRole === "customer"
        ? "Create an account or sign in to place and track your flower orders."
        : "Create an account or sign in to place and track your orders. Your name helps us prepare your order and greet you.";
    document.getElementById("showSignIn").classList.toggle("active", !signingUp);
    document.getElementById("showSignUp").classList.toggle("active", signingUp);
    fullNameInput.hidden = !signingUp;
    fullNameLabel.hidden = !signingUp;
    fullNameInput.required = signingUp;
    passwordInput.autocomplete = signingUp ? "new-password" : "current-password";
    confirmPasswordInput.hidden = !signingUp;
    confirmPasswordLabel.hidden = !signingUp;
    confirmPasswordInput.required = signingUp;
    confirmPasswordInput.value = "";
    passwordHint.hidden = !signingUp;
    submitAuthButton.textContent = signingUp ? "Create account" : "Sign in";
    setAuthMessage("");
}

function setAuthMessage(message, success = false) {
    authMessage.textContent = message;
    authMessage.classList.toggle("success", success);
}

function friendlyAuthMessage(error) {
    const code = String(error && error.code || "");
    if (code === "network_error") return "We couldn’t reach the server. Check your connection and try again.";
    return (error && error.message) || "We couldn’t complete that request. Please try again.";
}

function showAuthError(error) {
    console.error("Authentication request failed.", error);
    setAuthMessage(friendlyAuthMessage(error));
}

async function loadProfileWithRetry() {
    // The profile row is created by a database trigger right after sign-up; give it a moment.
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            return await getCurrentProfile();
        } catch (error) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    throw lastError;
}

async function goToDashboard() {
    try {
        const account = await loadProfileWithRetry();
        if (!account) return;
        if (expectedRole && account.profile.role !== expectedRole) {
            const actualRole = account.profile.role === "admin" ? "Admin" : "Customer";
            setAuthMessage(`This is a ${actualRole} account. Choose ${actualRole} sign-in to continue.`);
            return;
        }
        if (returnToCheckout && account.profile.role === "customer") {
            window.location.replace("index.html?checkout=1");
            return;
        }
        window.location.replace(dashboardForRole(account.profile.role));
    } catch (error) {
        showAuthError(error);
    }
}

function showEmailVerification(email) {
    pendingVerificationEmail = email;
    authForm.hidden = true;
    authTabs.hidden = true;
    emailVerificationForm.hidden = false;
    document.getElementById("formTitle").textContent = "Confirm your email";
    setAuthMessage(`We sent a 6-digit confirmation code to ${email}.`);
    emailVerificationCode.focus();
}

setAuthMode(authMode);
togglePasswordButton.addEventListener("click", () => {
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    confirmPasswordInput.type = show ? "text" : "password";
    togglePasswordButton.textContent = show ? "Hide" : "Show";
    togglePasswordButton.setAttribute("aria-pressed", String(show));
    togglePasswordButton.setAttribute("aria-label", show ? "Hide password" : "Show password");
});
document.getElementById("showSignIn").addEventListener("click", () => setAuthMode("signin"));
document.getElementById("showSignUp").addEventListener("click", () => setAuthMode("signup"));
document.getElementById("changeSignupEmail").addEventListener("click", () => {
    emailVerificationCode.value = "";
    setAuthMode("signup");
    emailInput.focus();
});
authForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!authForm.reportValidity()) return;
    if (!window.ajBloomApi) {
        setAuthMessage("The site could not load. Check your internet connection and refresh.");
        return;
    }

    submitAuthButton.disabled = true;
    setAuthMessage(authMode === "signup" ? "Creating your account…" : "Signing in…");
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const api = window.ajBloomApi;

    try {
        if (authMode === "signup") {
            if (password !== confirmPasswordInput.value) {
                setAuthMessage("The passwords don’t match. Please check and try again.");
                confirmPasswordInput.focus();
                return;
            }
            await api.signUp(email, password, fullNameInput.value.trim());
            showEmailVerification(email);
        } else {
            await api.signIn(email, password);
            await goToDashboard();
        }
    } catch (error) {
        if (error.code === "email_not_confirmed") {
            showEmailVerification(email);
            try {
                await api.resendCode(email);
            } catch (resendError) {
                console.error("Could not resend the email confirmation code.", resendError);
                setAuthMessage(`If you already have a code, enter it below. ${friendlyAuthMessage(resendError)}`);
            }
        } else if (error.code === "user_already_exists") {
            setAuthMode("signin");
            emailInput.value = email;
            setAuthMessage(error.message);
        } else {
            showAuthError(error);
        }
    } finally {
        submitAuthButton.disabled = false;
    }
});

emailVerificationForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!emailVerificationForm.reportValidity()) return;
    verifyEmailButton.disabled = true;
    setAuthMessage("Confirming your email…");
    try {
        await window.ajBloomApi.verifyEmail(pendingVerificationEmail, emailVerificationCode.value.trim());
        await goToDashboard();
    } catch (error) {
        showAuthError(error);
    } finally {
        verifyEmailButton.disabled = false;
    }
});

emailVerificationCode.addEventListener("input", () => {
    emailVerificationCode.value = emailVerificationCode.value.replace(/\D/g, "").slice(0, 6);
});

resendEmailCodeButton.addEventListener("click", async () => {
    resendEmailCodeButton.disabled = true;
    setAuthMessage("Sending a new confirmation code…");
    try {
        await window.ajBloomApi.resendCode(pendingVerificationEmail);
        setAuthMessage(`A new 6-digit code was sent to ${pendingVerificationEmail}.`, true);
    } catch (error) {
        showAuthError(error);
    } finally {
        setTimeout(() => { resendEmailCodeButton.disabled = false; }, 30000);
    }
});

if (window.ajBloomApi) {
    window.ajBloomApi.me().then(({ user }) => {
        if (user) goToDashboard();
    }).catch(showAuthError);
}
