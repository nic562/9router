import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCombos() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
  return rowToCombo(row);
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Prune models belonging to a provider from all combos.
 * @param {string} providerAlias - Provider alias or ID
 * @param {string[]} modelIds - Array of model IDs to remove
 * @returns {Promise<{ affectedCombos: Array<{ id: string, name: string, removedModels: string[], remainingCount: number }> }>}
 */
export async function pruneModelsFromCombos(providerAlias, modelIds) {
  if (!providerAlias || !Array.isArray(modelIds) || modelIds.length === 0) {
    return { affectedCombos: [] };
  }
  const idSet = new Set(modelIds.map((id) => String(id).trim()).filter(Boolean));
  if (idSet.size === 0) return { affectedCombos: [] };

  const rawAlias = String(providerAlias).trim();
  const providerLower = rawAlias.toLowerCase();
  const candidates = new Set([providerLower]);

  const ALIAS_MAP = {
    anthropic: "claude",
    claude: "anthropic",
    google: "gemini",
    gemini: "google",
    github: "copilot",
    copilot: "github",
    "grok-cli": "grok",
    grok: "grok-cli",
  };
  if (ALIAS_MAP[providerLower]) {
    candidates.add(ALIAS_MAP[providerLower]);
  }

  try {
    const { getProviderAlias, resolveProviderId } = await import("@/shared/constants/providers");
    const alias = getProviderAlias?.(rawAlias);
    const id = resolveProviderId?.(rawAlias);
    if (alias) candidates.add(String(alias).toLowerCase());
    if (id) candidates.add(String(id).toLowerCase());
  } catch {
    // Ignore dynamic import failure in isolated environments
  }

  const db = await getAdapter();
  const affectedCombos = [];

  db.transaction(() => {
    const rows = db.all("SELECT * FROM combos");
    for (const row of rows) {
      const combo = rowToCombo(row);
      const originalModels = combo.models || [];
      const removedModels = [];

      const remainingModels = originalModels.filter((item) => {
        if (!item || typeof item !== "string") return true;
        const slashIdx = item.indexOf("/");
        if (slashIdx > 0) {
          const itemProvider = item.slice(0, slashIdx).trim().toLowerCase();
          const itemModel = item.slice(slashIdx + 1).trim();
          if (candidates.has(itemProvider) && idSet.has(itemModel)) {
            removedModels.push(item);
            return false;
          }
        } else if (idSet.has(item.trim())) {
          removedModels.push(item);
          return false;
        }
        return true;
      });

      if (removedModels.length > 0) {
        const now = new Date().toISOString();
        db.run(
          "UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?",
          [stringifyJson(remainingModels), now, combo.id]
        );
        affectedCombos.push({
          id: combo.id,
          name: combo.name,
          removedModels,
          remainingCount: remainingModels.length,
        });
      }
    }
  });

  return { affectedCombos };
}
