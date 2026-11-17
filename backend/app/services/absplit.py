"""变体分流记录业务规则：接收新增模块（新增入口）推送的变体分流记录。

分流记录是实验看板指标明细数据集的唯一数据入口：记录先落表为「待核对」，
被已落定的指标数据集采用后才标记为「已入表」，保证看板侧消费的都是可核对的输入。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.store import store

MODULE = "absplit"
REQUIRED_FIELDS = ["分流记录编号", "关联实验", "变体编号", "分流占比", "指标窗口", "指标组合"]
STATUS_PENDING = "待核对"
STATUS_ENTERED = "已入表"
STATUS_ORDER = [STATUS_PENDING, STATUS_ENTERED]
DEFAULT_SOURCE = "新增入口"


class AbsplitService:
    def list_entries(
        self,
        *,
        keyword: str | None = None,
        status: str | None = None,
        experiment: str | None = None,
        page: int = 1,
        size: int = 20,
    ) -> tuple[list[dict[str, Any]], int]:
        rows = store.rows(MODULE)
        if keyword:
            rows = [row for row in rows if keyword in str(row.get("分流记录编号", ""))]
        if status:
            rows = [row for row in rows if row.get("status") == status]
        if experiment:
            rows = [row for row in rows if experiment in str(row.get("关联实验", ""))]
        total = len(rows)
        start = max(page - 1, 0) * size
        return rows[start:start + size], total

    def get_entry(self, entry_id: int) -> dict[str, Any] | None:
        return store.find(MODULE, entry_id)

    def create_entry(self, values: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
        missing = [field for field in REQUIRED_FIELDS if not str(values.get(field) or "").strip()]
        if missing:
            return None, missing
        rows = store.rows(MODULE)
        entry = {"id": max((int(row.get("id", 0)) for row in rows), default=0) + 1}
        entry.update({field: values.get(field) for field in REQUIRED_FIELDS})
        # 来源映射记录：没有显式给出来源时，按新增入口登记，后续版本核对凭它对照
        entry["来源标识"] = str(values.get("来源标识") or DEFAULT_SOURCE).strip() or DEFAULT_SOURCE
        entry["status"] = STATUS_PENDING
        entry["pending"] = True
        entry["abnormal"] = False
        entry["登记时间"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        rows.append(entry)
        return entry, []

    def mark_entered(self, record_ids: list[int]) -> None:
        """被已落定数据集采用的分流记录批量转为已入表。"""
        id_set = {int(rid) for rid in record_ids}
        for row in store.rows(MODULE):
            if int(row.get("id", 0)) in id_set and row.get("status") == STATUS_PENDING:
                row["status"] = STATUS_ENTERED
                row["pending"] = False
