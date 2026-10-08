const passwordForm = document.getElementById("passwordForm");
passwordForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!passwordForm.reportValidity()) return;

    const newPassword = passwordForm.elements.namedItem("newPassword").value;
    const confirmPassword = passwordForm.elements.namedItem("confirmPassword").value;
    const message = document.getElementById("passwordMessage");
    if (newPassword !== confirmPassword) {
        message.textContent = "The passwords do not match.";
        return;
    }

    const submitButton = passwordForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    message.textContent = "Saving your new password…";
    try {
        await window.ajBloomApi.changePassword(newPassword);
        passwordForm.reset();
        message.textContent = "Your password has been updated.";
    } catch (error) {
        console.error("Could not update the account password.", error);
        message.textContent = error.message || "We couldn’t update your password. Please try again.";
    } finally {
        submitButton.disabled = false;
    }
});
