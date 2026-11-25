import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import worker from "./worker.mjs";

function testDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(
    readFileSync(
      new URL("./drizzle/0000_private_groups.sql", import.meta.url),
      "utf8",
    ),
  );
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...args) {
          return {
            all: () => ({ results: statement.all(...args) }),
            first: () => statement.get(...args),
            run: () => ({ meta: statement.run(...args) }),
          };
        },
      };
    },
    batch(queries) {
      db.exec("BEGIN");
      try {
        const result = queries.map((query) => query.all());
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

test("group resources and invitations are scoped to membership", async () => {
  const env = { DB: testDatabase() };
  const [owner, member, outsider] = Array.from({ length: 3 }, () =>
    randomBytes(32).toString("hex"),
  );
  async function call(key, path, method = "GET", body) {
    const req = new Request("https://groups.example" + path, {
      method,
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return worker.fetch(req, env);
  }
  const created = await call(owner, "/groups", "POST", {
    name: "Office",
    member: "Owner",
  });
  assert.equal(created.status, 200);
  const group = "/groups/" + (await created.json()).id;
  assert.equal((await call(outsider, group)).status, 404);
  assert.equal(
    (await call(member, "/join", "POST", { member: "Colleague", code: "no" }))
      .status,
    400,
  );
  const invite = async () =>
    (await (await call(owner, group + "/invite", "POST", {})).json()).code;
  const oldCode = await invite(),
    code = await invite();
  assert.equal(
    (
      await call(member, "/join", "POST", {
        member: "Colleague",
        code: oldCode,
      })
    ).status,
    409,
  );
  assert.equal(
    (await call(member, "/join", "POST", { member: "Colleague", code })).status,
    200,
  );
  assert.equal(
    (await call(outsider, "/join", "POST", { member: "Visitor", code })).status,
    409,
  );
  assert.equal(
    (
      await call(owner, group + "/resources", "POST", {
        title: "Whiteboard",
        quantity: 1,
      })
    ).status,
    200,
  );
  const data = await (await call(member, group)).json();
  assert.equal(data.resources[0].title, "Whiteboard");
  assert.equal(data.resources[0].mine, 0);
  assert.equal(
    (await call(member, group + "/resources/" + data.resources[0].id, "DELETE"))
      .status,
    404,
  );
  assert.equal((await call(member, group + "/invite", "POST", {})).status, 403);
  assert.equal(
    (
      await call(outsider, group + "/resources", "POST", {
        title: "Foreign listing",
        quantity: 1,
      })
    ).status,
    404,
  );
  assert.equal(
    (await call(member, group + "/membership", "DELETE")).status,
    200,
  );
  assert.equal((await call(member, group)).status, 404);
  assert.equal((await call(owner, group, "DELETE")).status, 200);
  assert.deepEqual((await (await call(owner, "/groups")).json()).groups, []);
});
