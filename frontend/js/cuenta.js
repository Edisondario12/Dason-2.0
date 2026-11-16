const field = id => document.getElementById(id);
const form = field("credentials");
const mode = new URLSearchParams(location.search).get("modo");
const creating = mode === "crear";
const notice = field("notice");

async function request(action, data) {
  const options = data ? { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(data) } : {};
  const response = await fetch("/api/" + action, options);
  const result = await response.json().catch(() => { throw new Error("Abre DASON con el archivo Abrir DASON.command."); });
  if (action === "login" && response.status === 401) {
    throw new Error("Usuario no encontrado o contraseña incorrecta. Revisa tus datos e inténtalo de nuevo.");
  }
  if (!response.ok) throw new Error(result.error || "Vuelve a intentarlo.");
  return result;
}

async function showAccount() {
  if (!mode && (await request("session")).email) {
    location.replace("inicio.html");
    return;
  }
  const label = creating ? "Crear cuenta" : "Iniciar sesión";
  field("heading").textContent = field("submit").textContent = label;
  form.hidden = false;
  form.elements.password.autocomplete = creating ? "new-password" : "current-password";
  form.elements.password.minLength = creating ? 12 : 1;
  field("repeat").hidden = !creating;
  form.elements.confirmation.required = creating;
  field("switch").href = creating ? "?modo=entrar" : "?modo=crear";
  field("switch").textContent = creating ? "Ya tengo cuenta · Iniciar sesión" : "Crear una cuenta";
  notice.textContent = creating ? "Usa una contraseña de al menos 12 caracteres." :
    new URLSearchParams(location.search).has("creada") ? "Tu cuenta está creada. Inicia sesión con tu correo y contraseña." : "Ingresa el correo y la contraseña de tu cuenta.";
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const errorMessage = field("form-error");
  errorMessage.textContent = "";
  const {email, password, confirmation} = form.elements;
  if (creating && password.value !== confirmation.value) {
    errorMessage.textContent = "Las contraseñas deben coincidir.";
    confirmation.focus();
    return;
  }
  field("submit").disabled = true;
  try {
    await request(creating ? "register" : "login", {email:email.value, password:password.value});
    if (creating) {
      form.reset();
      form.hidden = true;
      field("heading").textContent = "Cuenta creada";
      notice.textContent = "Tu cuenta se guardó correctamente. Puedes iniciar sesión cuando quieras.";
      field("switch").textContent = "Iniciar sesión";
      field("heading").focus();
    } else {
      location.replace("inicio.html");
    }
  } catch (error) {
    errorMessage.textContent = error.message;
    field("submit").disabled = false;
  }
});
field("logout").addEventListener("click", async () => {
  try {
    await request("logout", {});
    location.replace("index.html");
  } catch (error) { notice.textContent = error.message; }
});
showAccount().catch(() => { notice.textContent = "Abre el proyecto con Abrir DASON.command para acceder a tu cuenta."; });
