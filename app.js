const db = supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);

let currentUser = null;
let currentProfile = null;
let subscriptions = [];

const $ = id => document.getElementById(id);

function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function showMessage(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.className = error ? "message error" : "message";
}

function statusLabel(status) {
  const labels = {
    active: "نشط",
    pending: "بانتظار التفعيل",
    expired: "منتهي",
    suspended: "موقوف"
  };

  return `<span class="status ${safe(status)}">${labels[status] || status}</span>`;
}

async function login(username, password) {
  username = username.trim().toLowerCase();

  const email = `${username}@login.eshra-panel.invalid`;

  const { data, error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) throw error;

  currentUser = data.user;

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();

  if (profileError || !profile || !profile.is_active) {
    await db.auth.signOut();
    throw new Error("الحساب غير مفعل أو غير موجود");
  }

  currentProfile = profile;
  openDashboard();
}

function openDashboard() {
  $("loginScreen").classList.add("hidden");
  $("dashboard").classList.remove("hidden");

  $("currentUsername").textContent = currentProfile.username;
  $("currentRole").textContent =
    currentProfile.role === "owner" ? "المالك الرئيسي" : "مدير فرعي";

  if (currentProfile.role === "owner") {
    document.querySelectorAll(".owner-only").forEach(el => {
      el.classList.remove("hidden");
    });
  }

  loadSubscriptions();
}

async function loadSubscriptions() {
  const { data, error } = await db
    .from("subscriptions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    alert("تعذر تحميل الاشتراكات: " + error.message);
    return;
  }

  subscriptions = data || [];
  renderSubscriptions();
}

function renderSubscriptions() {
  const today = new Date().toISOString().slice(0, 10);

  const active = subscriptions.filter(s =>
    s.status === "active" && s.end_date >= today
  );

  const expired = subscriptions.filter(s =>
    s.status === "expired" || s.end_date < today
  );

  const ending = subscriptions.filter(s => {
    const days = Math.ceil(
      (new Date(s.end_date) - new Date(today)) / 86400000
    );

    return s.status === "active" && days >= 0 && days <= 7;
  });

  $("totalCount").textContent = subscriptions.length;
  $("activeCount").textContent = active.length;
  $("expiredCount").textContent = expired.length;
  $("endingCount").textContent = ending.length;

  const search = ($("searchInput")?.value || "").toLowerCase();

  const filtered = subscriptions.filter(s =>
    s.customer_name.toLowerCase().includes(search) ||
    s.account_username.toLowerCase().includes(search)
  );

  $("subscriptionsTable").innerHTML = filtered.map(s => `
    <tr>
      <td>${safe(s.customer_name)}</td>
      <td>${safe(s.account_username)}</td>
      <td>${safe(s.start_date)}</td>
      <td>${safe(s.end_date)}</td>
      <td>${statusLabel(s.status)}</td>
      <td>
        <button class="action-btn" onclick="deleteSubscription('${s.id}')">
          حذف
        </button>
      </td>
    </tr>
  `).join("");

  $("recentTable").innerHTML = subscriptions.slice(0, 5).map(s => `
    <tr>
      <td>${safe(s.customer_name)}</td>
      <td>${safe(s.account_username)}</td>
      <td>${safe(s.end_date)}</td>
      <td>${statusLabel(s.status)}</td>
    </tr>
  `).join("");
}

async function addSubscription(event) {
  event.preventDefault();

  const record = {
    manager_id: currentUser.id,
    customer_name: $("customerName").value.trim(),
    account_username: $("accountUsername").value.trim(),
    start_date: $("startDate").value,
    end_date: $("endDate").value,
    status: $("subscriptionStatus").value,
    notes: $("subscriptionNotes").value.trim(),
    server_host: window.APP_CONFIG.SERVER_HOST,
    server_port: window.APP_CONFIG.SERVER_PORT
  };

  if (record.end_date < record.start_date) {
    showMessage("subscriptionMessage", "تاريخ الانتهاء غير صحيح", true);
    return;
  }

  const duplicate = subscriptions.some(s =>
    s.account_username.toLowerCase() ===
    record.account_username.toLowerCase()
  );

  if (duplicate) {
    showMessage(
      "subscriptionMessage",
      "اسم المستخدم موجود بالفعل في اللوحة",
      true
    );
    return;
  }

  const { error } = await db
    .from("subscriptions")
    .insert(record);

  if (error) {
    showMessage("subscriptionMessage", error.message, true);
    return;
  }

  $("subscriptionForm").reset();
  showMessage("subscriptionMessage", "تم حفظ الاشتراك بنجاح");
  await loadSubscriptions();
}

async function deleteSubscription(id) {
  if (!confirm("هل تريد حذف هذا الاشتراك؟")) return;

  const { error } = await db
    .from("subscriptions")
    .delete()
    .eq("id", id);

  if (error) {
    alert(error.message);
    return;
  }

  await loadSubscriptions();
}

async function createManager(event) {
  event.preventDefault();

  const username = $("managerUsername").value.trim();
  const password = $("managerPassword").value;

  const { data, error } = await db.functions.invoke("create-manager", {
    body: { username, password }
  });

  if (error || data?.error) {
    showMessage(
      "managerMessage",
      data?.error || error.message,
      true
    );
    return;
  }

  showMessage("managerMessage", "تم إنشاء المدير بنجاح");
  $("managerForm").reset();
  await loadManagers();
}

async function loadManagers() {
  if (currentProfile.role !== "owner") return;

  const { data, error } = await db
    .from("profiles")
    .select("id,username,is_active,role")
    .eq("role", "manager")
    .order("created_at", { ascending: false });

  if (error) {
    showMessage("managerMessage", error.message, true);
    return;
  }

  $("managersTable").innerHTML = (data || []).map(m => `
    <tr>
      <td>${safe(m.username)}</td>
      <td>${m.is_active ? "مفعل" : "معطل"}</td>
      <td>
        <button class="action-btn"
          onclick="toggleManager('${m.id}', ${m.is_active})">
          ${m.is_active ? "تعطيل" : "تفعيل"}
        </button>
      </td>
    </tr>
  `).join("");
}

async function toggleManager(id, currentState) {
  if (currentProfile.role !== "owner") return;

  if (!confirm(currentState ? "تعطيل هذا المدير؟" : "تفعيل هذا المدير؟")) {
    return;
  }

  const { error } = await db
    .from("profiles")
    .update({ is_active: !currentState })
    .eq("id", id)
    .eq("role", "manager");

  if (error) {
    alert(error.message);
    return;
  }

  await loadManagers();
}

function showPage(page) {
  document.querySelectorAll(".page").forEach(el =>
    el.classList.add("hidden")
  );

  document.querySelectorAll(".nav-btn").forEach(el =>
    el.classList.remove("active")
  );

  const pages = {
    home: ["homePage", "الرئيسية"],
    subscriptions: ["subscriptionsPage", "اشتراكات CCcam"],
    managers: ["managersPage", "المديرون"]
  };

  if (page === "managers" && currentProfile.role !== "owner") {
    return;
  }

  $(pages[page][0]).classList.remove("hidden");
  $("pageTitle").textContent = pages[page][1];

  document.querySelector(`[data-page="${page}"]`)
    ?.classList.add("active");

  if (page === "managers") loadManagers();
}

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    await login(
      $("loginUsername").value,
      $("loginPassword").value
    );
  } catch (error) {
    showMessage("loginMessage", error.message, true);
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await db.auth.signOut();
  location.reload();
});

$("subscriptionForm").addEventListener("submit", addSubscription);
$("managerForm").addEventListener("submit", createManager);

$("showAddForm").addEventListener("click", () => {
  $("addSubscriptionPanel").classList.toggle("hidden");
});

$("searchInput").addEventListener("input", renderSubscriptions);

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
  });
});

async function restoreSession() {
  const { data } = await db.auth.getSession();

  if (!data.session) return;

  currentUser = data.session.user;

  const { data: profile } = await db
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();

  if (!profile || !profile.is_active) {
    await db.auth.signOut();
    return;
  }

  currentProfile = profile;
  openDashboard();
}

restoreSession();
