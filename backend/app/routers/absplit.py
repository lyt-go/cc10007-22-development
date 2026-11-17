"""变体分流记录接口：接收新增模块入口推送的分流记录，作为看板指标数据集的唯一输入。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.schemas import ActionResult, EntryPayload, PageResult
from app.services.absplit import AbsplitService, STATUS_ORDER

router = APIRouter(prefix="/api/absplit", tags=["变体分流记录"])

service = AbsplitService()

LIST_FIELDS = ["分流记录编号", "关联实验", "变体编号", "来源标识", "分流占比", "指标窗口", "指标组合"]
STATUSES = STATUS_ORDER


@router.get("", response_model=PageResult[dict])
def list_entries(
    keyword: str | None = Query(default=None, description="按分流记录编号检索"),
    status: str | None = Query(default=None, description="待核对、已入表"),
    experiment: str | None = Query(default=None, description="按关联实验检索"),
    page: int = 1,
    size: int = 20,
) -> PageResult[dict]:
    """按记录编号、状态、关联实验过滤分流记录；没有数据时返回空页，不报错。"""
    if size > 200:
        raise HTTPException(status_code=400, detail="每页最多 200 条，请缩小分页范围")
    items, total = service.list_entries(
        keyword=keyword, status=status, experiment=experiment, page=page, size=size
    )
    return PageResult(items=items, total=total, page=page, size=size)


@router.get("/export")
def export_entries() -> dict[str, Any]:
    """导出变体分流记录清单：返回当前全量数据。"""
    items, total = service.list_entries(page=1, size=10000)
    return {"module": "absplit", "total": total, "items": items}


@router.get("/{entry_id}", response_model=dict)
def get_entry(entry_id: int) -> dict:
    """读取单条分流记录明细；不存在时给出可读的错误说明。"""
    entry = service.get_entry(entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"分流记录 {entry_id} 不存在或已归档")
    return entry


@router.post("", response_model=ActionResult)
def create_entry(payload: EntryPayload) -> ActionResult:
    """登记一条由新增模块入口推送的变体分流记录，缺字段时说明原因而不是静默丢弃。"""
    entry, missing = service.create_entry(payload.values)
    if missing:
        return ActionResult(ok=False, message=f"缺少必填字段：{'、'.join(missing)}")
    return ActionResult(ok=True, message="变体分流记录已登记，等待指标数据集核对", entry=entry)
