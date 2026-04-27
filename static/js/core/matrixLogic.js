// 行を追加
export function addRow(table, defaultValue = "0") {

  const currentRows = table.rows.length;
  const cols = table.rows[0].cells.length;

  if (currentRows === 0) return;
  if (currentRows >= 8) return;

  const r = table.insertRow();
  for (let i = 0; i < cols; i++) {
    const td = r.insertCell();
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = defaultValue;
    td.appendChild(inp);
  }
}

// 行を削除
export function removeRow(table) {
  if (table.rows.length > 1) table.deleteRow(-1);
}

// 列を追加
export function addCol(table, defaultValue = "0") {

  const cols = table.rows[0].cells.length;
  if (cols === 0) return;
  if (cols >= 8) return;

  for (const r of table.rows) {
    const td = r.insertCell();
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = defaultValue;
    td.appendChild(inp);
  }
}

// 列を削除
export function removeCol(table) {
  if (table.rows.length === 0) return;

  const cols = table.rows[0].cells.length;
  if (cols > 1) {
    for (const r of table.rows) r.deleteCell(-1);
  }
}
