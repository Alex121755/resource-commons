"use strict";
const service = "https://resource-commons-waicy.alexl202301.chatgpt.site";
const $ = (id) => document.getElementById(id);
const profileSlot = "rc-private-group-profile";
let profile,
  active,
  busy = false;
let requestedItem = new URLSearchParams(location.hash.slice(1)).get("item");
try {
  const saved = JSON.parse(sessionStorage.getItem(profileSlot));
  if (
    saved &&
    /^[a-f0-9]{64}$/.test(saved.key) &&
    typeof saved.member === "string"
  )
    profile = saved;
} catch {
  /* A profile can still be opened in this tab. */
}

function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
function make(tag, text) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
}
function action(label, fn) {
  const button = make("button", label);
  button.type = "button";
  button.addEventListener("click", fn);
  return button;
}
async function api(path, method = "GET", body) {
  const res = await fetch(service + path, {
    method,
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: {
      Authorization: "Bearer " + profile.key,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      data.error || "The group service could not complete this request.",
    );
  return data;
}
async function run(task) {
  if (busy) return;
  busy = true;
  $("workspace").setAttribute("aria-busy", "true");
  document.querySelectorAll("main button").forEach((b) => (b.disabled = true));
  status("Connecting…");
  try {
    await task();
    if ($("status").textContent === "Connecting…") status("");
  } catch (error) {
    status(
      error instanceof TypeError || error.name === "TimeoutError"
        ? "Could not reach the group service. Check your connection and try again."
        : error.message,
      true,
    );
  } finally {
    busy = false;
    $("workspace").removeAttribute("aria-busy");
    document
      .querySelectorAll("main button")
      .forEach((b) => (b.disabled = false));
  }
}
function setProfile(value) {
  profile = value;
  try {
    if (value) sessionStorage.setItem(profileSlot, JSON.stringify(value));
    else sessionStorage.removeItem(profileSlot);
  } catch {
    /* The current profile is still usable in memory. */
  }
  $("profile-entry").hidden = !!value;
  $("workspace").hidden = !value;
  $("display-name").textContent = value?.member || "";
}
function clearGroup() {
  active = null;
  $("invite-result").hidden = true;
  $("invite-code").value = "";
  $("group-view").hidden = true;
  $("empty").hidden = false;
  $("listings").replaceChildren();
  $("group-name").textContent = "";
  $("share-form").reset();
}
function inventoryOptions() {
  const select = $("local-items");
  select.replaceChildren(new Option("Enter an item manually", ""));
  try {
    const saved = JSON.parse(localStorage.getItem("resource-commons-demo-v1"));
    const state = saved || window.ResourceEngine?.seed();
    for (const item of state?.items || []) {
      if (
        typeof item.name !== "string" ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1
      )
        continue;
      const option = new Option(item.name, String(select.length));
      option.dataset.quantity = String(item.quantity);
      option.dataset.itemId = item.id;
      select.add(option);
    }
  } catch {
    /* Manual entry remains available. */
  }
  $("inventory-picker").hidden = select.length < 2;
  if (requestedItem) {
    const match = Array.from(select.options).find(
      (option) => option.dataset.itemId === requestedItem,
    );
    if (match) {
      select.value = match.value;
      select.dispatchEvent(new Event("change"));
    }
  }
}
async function displayGroup(id) {
  if (active?.id !== id) clearGroup();
  const data = await api("/groups/" + id);
  active = data;
  $("empty").hidden = true;
  $("group-view").hidden = false;
  $("group-name").textContent = data.name;
  $("member-count").textContent =
    data.memberCount +
    " " +
    (data.memberCount === 1 ? "member" : "members") +
    " · " +
    (data.is_owner ? "You own this group" : "You are a member");
  $("invite").hidden = !data.is_owner;
  $("exit-group").textContent = data.is_owner ? "Delete group" : "Leave group";
  $("listings").replaceChildren();
  if (!data.resources.length)
    $("listings").append(make("p", "No shared resources yet."));
  for (const item of data.resources) {
    const article = make("article");
    article.append(
      make("strong", item.title),
      make(
        "small",
        "Quantity: " + item.quantity + " · Shared by " + item.author,
      ),
    );
    if (item.note) article.append(make("p", item.note));
    if (item.mine) {
      const button = action("Remove listing", () =>
        run(async () => {
          if (!confirm("Remove this listing from the group?")) return;
          await api("/groups/" + id + "/resources/" + item.id, "DELETE");
          await displayGroup(id);
          status("Listing removed.");
        }),
      );
      button.className = "quiet";
      article.append(button);
    }
    $("listings").append(article);
  }
  document.querySelectorAll("#group-list button").forEach((b) => {
    if (b.dataset.id === id) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  });
  inventoryOptions();
}
async function loadGroups(selectId) {
  const { groups } = await api("/groups");
  $("group-list").replaceChildren();
  if (!groups.length)
    $("group-list").append(make("p", "You haven’t joined a group yet."));
  for (const group of groups) {
    const button = action(group.name, () => run(() => displayGroup(group.id)));
    button.dataset.id = group.id;
    $("group-list").append(button);
  }
  const chosen = groups.find((g) => g.id === selectId) || groups[0];
  if (chosen) await displayGroup(chosen.id);
  else clearGroup();
}
function showMemberKey() {
  $("member-key").value = profile.key;
  $("member-key").type = "password";
  $("show-key").textContent = "Show key";
  $("key-status").textContent = "";
  $("key-dialog").showModal();
}
$("profile-form").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const form = event.target,
      entered = form.elements.key.value.trim(),
      member = form.elements.member.value.trim();
    if (!member) throw new Error("Enter a display name.");
    if ($("restore").open && !/^[a-f0-9]{64}$/.test(entered))
      throw new Error("Enter the complete member key.");
    const key =
      entered ||
      Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error("Enter the complete member key.");
    setProfile({ key, member });
    form.reset();
    $("restore").open = false;
    if (!entered) showMemberKey();
    await loadGroups();
  });
});
$("copy-key").onclick = showMemberKey;
$("show-key").onclick = () => {
  const key = $("member-key");
  key.type = key.type === "password" ? "text" : "password";
  $("show-key").textContent = key.type === "password" ? "Show key" : "Hide key";
};
$("copy-member-key").onclick = async () => {
  try {
    await navigator.clipboard.writeText(profile.key);
    $("key-status").textContent = "Copied. Store your key privately.";
  } catch {
    $("member-key").type = "text";
    $("member-key").select();
    $("key-status").textContent = "Select and copy the key manually.";
  }
};
$("close-key").onclick = () => $("key-dialog").close();
$("key-dialog").addEventListener("close", () => {
  $("member-key").value = "";
});
$("sign-out").onclick = () => {
  if (
    !confirm(
      "Sign out of this tab? You will need your saved member key to return.",
    )
  )
    return;
  clearGroup();
  $("group-list").replaceChildren();
  setProfile(null);
  status("Signed out.");
};
$("create-form").onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    const form = event.target;
    const group = await api("/groups", "POST", {
      name: form.elements.name.value,
      member: profile.member,
    });
    form.reset();
    await loadGroups(group.id);
    status("Group created. Invite someone to join.");
  });
};
$("join-form").onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    const form = event.target;
    const group = await api("/join", "POST", {
      code: form.elements.code.value.trim(),
      member: profile.member,
    });
    form.reset();
    await loadGroups(group.id);
    status("You joined the group.");
  });
};
$("invite").onclick = () =>
  run(async () => {
    const invitation = await api(
      "/groups/" + active.id + "/invite",
      "POST",
      {},
    );
    $("invite-code").value = invitation.code;
    $("invite-result").hidden = false;
    status("Invitation ready.");
  });
$("copy-invite").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("invite-code").value);
    status("Invitation copied.");
  } catch {
    $("invite-code").select();
    status("Select and copy the invitation manually.");
  }
};
$("local-items").onchange = (event) => {
  const option = event.target.selectedOptions[0];
  if (!option.value) return;
  const fields = $("share-form").elements;
  fields.title.value = option.text;
  fields.quantity.value = option.dataset.quantity;
};
$("share-form").onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    const form = event.target,
      fields = form.elements,
      id = active.id;
    await api("/groups/" + id + "/resources", "POST", {
      title: fields.title.value,
      quantity: Number(fields.quantity.value),
      note: fields.note.value,
    });
    requestedItem = null;
    history.replaceState(null, "", location.pathname + location.search);
    form.reset();
    await displayGroup(id);
    status("Shared with " + active.name + ".");
  });
};
$("refresh").onclick = () => run(() => loadGroups(active?.id));
$("exit-group").onclick = () =>
  run(async () => {
    const owned = active.is_owner;
    if (
      !confirm(
        owned
          ? "Delete this group and all of its listings for every member?"
          : "Leave this group and remove your listings?",
      )
    )
      return;
    await api("/groups/" + active.id + (owned ? "" : "/membership"), "DELETE");
    clearGroup();
    await loadGroups();
    status(owned ? "Group deleted." : "You left the group.");
  });
setProfile(profile);
if (profile) run(() => loadGroups());
