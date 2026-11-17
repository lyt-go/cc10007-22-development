"""实验看板指标明细数据集接口：生成、落定、发布、版本核对与订阅告警查询。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.schemas import ActionResult, EntryPayload, PageResult
from app.services.abmetric import DEFAULT_VIEW_CODE, abmetric_service

router = APIRouter(prefix="/api/abmetric", tags=["实验看板指标明细"])

service = abmetric_service


@router.get("/versions")
def list_versions() -> dict[str, Any]:
    """列出数据集版本流水：每版的状态、批次、来源分流记录与剔除明细都可核对。"""
    return {"module": "abmetric", "items": service.list_versions()}


@router.get("/notifications")
def list_notifications(
    view_code: str | None = Query(default=None, description="按看板视图编号过滤订阅告警通知"),
) -> dict[str, Any]:
    """订阅告警通知：随当前看板指标同步更新后的通知留痕。"""
    return {"module": "abnotify", "items": service.list_notifications(view_code)}


@router.get("/check")
def concurrent_check(
    view_code: str | None = Query(default=None, description="按看板视图编号核对，默认 DASH-0002"),
) -> dict[str, Any]:
    """并发核对：只采用已落定（含已发布）数据集，待落定版本不会出现。"""
    return service.concurrent_check(view_code)


@router.get("/export")
def export_entries(
    version: int | None = Query(default=None, description="按版本号导出"),
    view_code: str | None = Query(default=None),
) -> dict[str, Any]:
    """导出指标明细数据集清单。"""
    items, total = service.list_entries(version=version, view_code=view_code, page=1, size=10000)
    return {"module": "abmetric", "total": total, "items": items}


@router.get("", response_model=PageResult[dict])
def list_entries(
    version: int | None = Query(default=None, description="按数据集版本号过滤"),
    view_code: str | None = Query(default=None, description="按看板视图编号过滤"),
    row_type: str | None = Query(default=None, description="变体明细、实验合并"),
    page: int = 1,
    size: int = 20,
) -> PageResult[dict]:
    """分页读取指标明细行；未指定版本时返回全部版本，配合状态字段区分数据版本。"""
    if size > 200:
        raise HTTPException(status_code=400, detail="每页最多 200 条，请缩小分页范围")
    items, total = service.list_entries(
        version=version, view_code=view_code, row_type=row_type, page=page, size=size
    )
    return PageResult(items=items, total=total, page=page, size=size)


@router.post("/generate", response_model=ActionResult)
def generate_dataset(payload: EntryPayload) -> ActionResult:
    """按看板指标配置的新字段范围读取分流记录并生成待落定数据集。

    入参 values 可带 view_code（默认 DASH-0002）与 remark；
    未生效变体不进入数据集，结果里返回被剔除的分流记录编号。
    """
    view_code = str(payload.values.get("view_code") or DEFAULT_VIEW_CODE).strip()
    manifest, message = service.generate_dataset(view_code=view_code, remark=payload.remark)
    if manifest is None:
        return ActionResult(ok=False, message=message)
    return ActionResult(ok=True, message=message, entry=manifest)


@router.post("/{version}/settle", response_model=ActionResult)
def settle_dataset(version: int) -> ActionResult:
    """整批落定数据集：落定后并发核对与发布才能采用这一版本。"""
    manifest, message = service.settle_dataset(version)
    if manifest is None:
        return ActionResult(ok=False, message=message)
    return ActionResult(ok=True, message=message, entry=manifest)


@router.post("/{version}/publish", response_model=ActionResult)
def publish_dataset(version: int) -> ActionResult:
    """发布到运营看板：回写视图数据版本与告警线状态，并同步订阅告警通知。"""
    manifest, message = service.publish_dataset(version)
    if manifest is None:
        return ActionResult(ok=False, message=message)
    return ActionResult(ok=True, message=message, entry=manifest)
