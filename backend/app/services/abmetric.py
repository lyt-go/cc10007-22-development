"""实验看板指标明细数据集业务规则。

发布准入与口径全部收敛在这里：
1. 只从变体分流记录（absplit，新增模块入口）读取输入，并按看板视图「指标组合」的
   新字段范围过滤；
2. 发布准入：只有「已生效」变体的分流记录才能进入当前看板，未生效变体一律剔除；
3. 同一实验的多个已生效变体在同一指标窗口会产生多组当前指标，这里按分流占比加权
   合并成唯一一套可解释的当前指标组合（变体级明细仍然保留，用于展示指标差异）；
4. 变体状态与指标组合在同一批次提交：同一版本号/批次号下一次写齐变体明细行与
   实验合并行，状态流转（落定、发布）也按整批切换；
5. 并发核对只采用「已落定」数据集，待落定版本不会被看板或核对接口读取；
6. 发布后把数据版本、告警线状态、订阅告警通知同步回运营看板视图，发布准入可凭
   数据版本逐版核对。
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from app.store import store

MODULE = "abmetric"
VERSION_MODULE = "abmetric_version"
NOTIFY_MODULE = "abnotify"

DASHBOARD_MODULE = "dashboard"
ABVARIANT_MODULE = "abvariant"
ABSPLIT_MODULE = "absplit"

DEFAULT_VIEW_CODE = "DASH-0002"
EFFECTIVE_STATUS = "已生效"

VERSION_DRAFT = "待落定"
VERSION_SETTLED = "已落定"
VERSION_PUBLISHED = "已发布"

NOTIFY_PREFIX = "ABNT"
_SPLIT_RE = re.compile(r"[，,;；\n]+")
_ALARM_RE = re.compile(r"^\s*([^<>=!]+?)\s*(>=|<=|==|=|>|<)\s*([-+]?\d+(?:\.\d+)?)\s*$")


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _to_number(value: Any) -> float | None:
    """把 '0.12'、'12%'、12 这类口径统一转成数值；无法解析时返回 None。"""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("％", "%")
    if not text:
        return None
    percent = text.endswith("%")
    text = text.rstrip("%").strip()
    try:
        number = float(text)
    except ValueError:
        return None
    return number / 100 if percent else number


def _to_ratio(value: Any) -> float:
    """分流占比：支持 0.3 与 30% 两种写法，无法解析时按 0 处理。"""
    number = _to_number(value)
    if number is None:
        return 0.0
    return number


def _parse_metric_names(raw: Any) -> list[str]:
    """解析看板视图配置的指标组合字段范围。"""
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if isinstance(raw, dict):
        return [str(item).strip() for item in raw if str(item).strip()]
    return [part.strip() for part in _SPLIT_RE.split(str(raw or "")) if part.strip()]


def _parse_metric_payload(raw: Any) -> dict[str, float]:
    """分流记录里的指标组合支持 dict 或 '指标A=0.1,指标B=0.2' 文本。"""
    if isinstance(raw, dict):
        parsed: dict[str, float] = {}
        for key, value in raw.items():
            number = _to_number(value)
            if number is not None:
                parsed[str(key).strip()] = number
        return parsed
    metrics: dict[str, float] = {}
    for part in _SPLIT_RE.split(str(raw or "")):
        if "=" not in part:
            continue
        name, value = part.split("=", 1)
        number = _to_number(value)
        if name.strip() and number is not None:
            metrics[name.strip()] = number
    return metrics


def _parse_alarm_rules(raw: Any) -> list[dict[str, Any]]:
    """解析告警线配置，形如 '点击率>=0.12；转化率<0.03'。"""
    rules: list[dict[str, Any]] = []
    if isinstance(raw, dict):
        for name, rule_text in raw.items():
            rules.extend(_parse_alarm_rules(f"{name}{rule_text}"))
        return rules
    for part in _SPLIT_RE.split(str(raw or "")):
        match = _ALARM_RE.match(part)
        if not match:
            continue
        name, operator, limit_text = match.groups()
        rules.append({"指标": name.strip(), "运算符": operator, "阈值": float(limit_text), "原文": part.strip()})
    return rules


def _eval_alarms(metrics: dict[str, float], rules: list[dict[str, Any]]) -> tuple[str, list[str]]:
    """按告警线判断合并后的当前指标组合，返回状态与逐条结论。"""
    if not rules:
        return "未配置告警线", []
    details: list[str] = []
    breached = False
    for rule in rules:
        value = metrics.get(rule["指标"])
        if value is None:
            details.append(f"{rule['原文']}：指标缺失，未判定")
            continue
        operator = rule["运算符"]
        limit = rule["阈值"]
        hit = (
            (operator == ">=" and value >= limit)
            or (operator == "<=" and value <= limit)
            or (operator == ">" and value > limit)
            or (operator == "<" and value < limit)
            or (operator in ("=", "==") and value == limit)
        )
        if hit:
            breached = True
        details.append(f"{rule['原文']}（当前 {value:g}）→ {'触发' if hit else '正常'}")
    return ("触发" if breached else "正常"), details


class AbmetricService:
    # ------------------------------------------------------------------ 数据集生成
    def generate_dataset(
        self,
        *,
        view_code: str = DEFAULT_VIEW_CODE,
        remark: str | None = None,
    ) -> tuple[dict[str, Any] | None, str]:
        """按看板视图字段范围读取分流记录，生成一版待落定的指标明细数据集。"""
        view = self._find_view(view_code)
        if view is None:
            return None, f"看板视图 {view_code} 不存在，无法确定指标字段范围"

        field_range = _parse_metric_names(view.get("指标组合"))
        if not field_range:
            return None, f"看板视图 {view_code} 未配置指标组合字段范围，无法计算看板指标"

        effective = {
            str(row.get("变体编号")): row
            for row in store.rows(ABVARIANT_MODULE)
            if row.get("status") == EFFECTIVE_STATUS
        }
        rules = _parse_alarm_rules(view.get("告警线配置"))

        # 同一变体若存在多条窗口记录，取最新一条（id 最大）参与计算
        chosen: dict[tuple[str, str], dict[str, Any]] = {}
        excluded_ineffective: list[str] = []
        excluded_out_of_scope: list[str] = []
        for record in store.rows(ABSPLIT_MODULE):
            variant_code = str(record.get("变体编号") or "")
            experiment = str(record.get("关联实验") or "")
            if variant_code not in effective:
                # 发布准入：未生效变体不能进入当前看板
                excluded_ineffective.append(str(record.get("分流记录编号") or variant_code))
                continue
            metrics = _parse_metric_payload(record.get("指标组合"))
            if not all(name in metrics for name in field_range):
                excluded_out_of_scope.append(str(record.get("分流记录编号") or variant_code))
                continue
            key = (experiment, variant_code)
            if key not in chosen or int(record.get("id", 0)) > int(chosen[key].get("id", 0)):
                chosen[key] = record

        if not chosen:
            return None, "字段范围内没有已生效变体的分流记录，数据集未生成"

        version = self._next_version()
        batch = "B" + datetime.now().strftime("%Y%m%d%H%M%S")
        generated_at = _now()
        rows = store.rows(MODULE)
        source_ids: list[int] = []
        variant_rows_count = 0

        for experiment in sorted({key[0] for key in chosen}):
            group = {key: record for key, record in chosen.items() if key[0] == experiment}
            # 基准变体：同实验内分流占比最低的已生效变体
            baseline_key = min(group, key=lambda key: _to_ratio(group[key].get("分流占比")))
            baseline_metrics = _parse_metric_payload(group[baseline_key].get("指标组合"))
            weight_sum = sum(_to_ratio(record.get("分流占比")) for record in group.values()) or 1.0

            merged: dict[str, float] = {}
            for name in field_range:
                merged[name] = sum(
                    _parse_metric_payload(record.get("指标组合"))[name]
                    * _to_ratio(record.get("分流占比"))
                    for record in group.values()
                ) / weight_sum
            alarm_status, alarm_details = _eval_alarms(merged, rules)

            for (exp, variant_code), record in sorted(group.items()):
                metrics = _parse_metric_payload(record.get("指标组合"))
                diffs = self._diff_against_baseline(
                    metrics, baseline_metrics, field_range,
                    is_baseline=(exp, variant_code) == baseline_key,
                )
                variant = effective[variant_code]
                rows.append(self._build_row(
                    version=version, batch=batch, view_code=view_code, generated_at=generated_at,
                    row_type="变体明细", experiment=exp, variant_code=variant_code,
                    variant_name=str(variant.get("变体名称") or ""),
                    variant_status=EFFECTIVE_STATUS,
                    ratio=_to_ratio(record.get("分流占比")),
                    window=str(record.get("指标窗口") or ""),
                    metrics=metrics, field_range=field_range, diffs=diffs,
                    alarm_status="随实验合并行判定", alarm_details=[],
                    source_id=int(record.get("id", 0)), source_code=str(record.get("分流记录编号") or ""),
                    source_tag=str(record.get("来源标识") or ""),
                    remark=remark,
                ))
                source_ids.append(int(record.get("id", 0)))
                variant_rows_count += 1

            merged_diffs = [f"{name}={value:g}" for name, value in merged.items()]
            rows.append(self._build_row(
                version=version, batch=batch, view_code=view_code, generated_at=generated_at,
                row_type="实验合并", experiment=experiment, variant_code="—",
                variant_name="按分流占比加权合并", variant_status="—",
                ratio=weight_sum, window="最新指标窗口",
                metrics=merged, field_range=field_range,
                diffs=[f"加权合并（一套当前指标组合）：{'；'.join(merged_diffs)}"],
                alarm_status=alarm_status, alarm_details=alarm_details,
                source_id=0, source_code="、".join(
                    str(record.get("分流记录编号") or "") for record in group.values()
                ),
                source_tag="、".join(
                    str(record.get("来源标识") or "") for record in group.values()
                ),
                remark=remark,
            ))

        manifest = {
            "id": version,
            "版本号": version,
            "批次号": batch,
            "视图编号": view_code,
            "字段范围": field_range,
            "status": VERSION_DRAFT,
            "pending": True,
            "abnormal": False,
            "生成时间": generated_at,
            "落定时间": None,
            "发布时间": None,
            "实验数": len({key[0] for key in chosen}),
            "变体明细行数": variant_rows_count,
            "明细行数": variant_rows_count + len({key[0] for key in chosen}),
            "来源分流记录": source_ids,
            "剔除未生效记录": excluded_ineffective,
            "剔除超字段范围记录": excluded_out_of_scope,
            "准入说明": "仅已生效变体进入数据集；变体状态与指标组合同批次提交",
            "备注": remark,
        }
        store.rows(VERSION_MODULE).append(manifest)
        return {
            "版本号": version,
            "批次号": batch,
            "视图编号": view_code,
            "字段范围": field_range,
            "明细行数": manifest["明细行数"],
            "剔除未生效记录": excluded_ineffective,
            "剔除超字段范围记录": excluded_out_of_scope,
        }, "实验看板指标明细数据集已生成（待落定），变体状态与指标组合已同批次提交"

    def settle_dataset(self, version: int) -> tuple[dict[str, Any] | None, str]:
        """整批落定：落定后并发核对与看板发布才允许采用这版数据。"""
        manifest = self._find_manifest(version)
        if manifest is None:
            return None, f"数据集版本 {version} 不存在"
        if manifest["status"] != VERSION_DRAFT:
            return None, f"数据集版本 {version} 当前为{manifest['status']}，不能重复落定"
        settled_at = _now()
        for row in store.rows(MODULE):
            if int(row.get("版本号", 0)) == version:
                row["status"] = VERSION_SETTLED
                row["pending"] = False
                row["落定时间"] = settled_at
        manifest["status"] = VERSION_SETTLED
        manifest["pending"] = False
        manifest["落定时间"] = settled_at
        # 分流记录随落定批次转为已入表，保证后续核对能凭来源映射对照
        from app.services.absplit import AbsplitService
        AbsplitService().mark_entered(list(manifest["来源分流记录"]))
        return manifest, f"数据集版本 {version} 已落定，并发核对将只采用这版数据"

    def publish_dataset(self, version: int) -> tuple[dict[str, Any] | None, str]:
        """发布到运营看板：回写视图数据版本，并同步订阅告警通知。"""
        manifest = self._find_manifest(version)
        if manifest is None:
            return None, f"数据集版本 {version} 不存在"
        if manifest["status"] != VERSION_SETTLED:
            return None, f"数据集版本 {version} 尚未落定（当前 {manifest['status']}），不能发布到看板"
        view = self._find_view(str(manifest["视图编号"]))
        if view is None:
            return None, f"看板视图 {manifest['视图编号']} 不存在，发布中止"

        published_at = _now()
        version_rows = [
            row for row in store.rows(MODULE)
            if int(row.get("版本号", 0)) == version
        ]
        merged_rows = [row for row in version_rows if row.get("行类型") == "实验合并"]
        alarm_summary = "；".join(
            f"{row['关联实验']}：{row['告警线状态']}" for row in merged_rows
        ) or "无实验合并行"
        breached = any(row["告警线状态"] == "触发" for row in merged_rows)

        # 同一批次整批切换为已发布
        for row in version_rows:
            row["status"] = VERSION_PUBLISHED
            row["发布时间"] = published_at
        manifest["status"] = VERSION_PUBLISHED
        manifest["发布时间"] = published_at

        # 回写运营看板视图：发布准入可从数据版本逐版核对
        view["指标数据版本"] = version
        view["发布批次号"] = manifest["批次号"]
        view["发布准入"] = "已通过：仅已生效变体入看板"
        view["告警线状态"] = "触发" if breached else "正常"
        view["告警同步状态"] = f"已同步（{published_at}）"
        view["订阅同步状态"] = f"已同步（{published_at}）"
        view["最近发布时间"] = published_at
        view["关联实验数"] = manifest["实验数"]

        notify_count = self._sync_notifications(view, manifest, merged_rows, published_at)
        return manifest, (
            f"数据集版本 {version} 已发布到看板视图 {view['视图编号']}，"
            f"告警线：{alarm_summary}；订阅告警通知 {notify_count} 条已随当前看板指标同步更新"
        )

    def concurrent_check(self, view_code: str | None = None) -> dict[str, Any]:
        """并发核对：只返回已落定（含已发布）的最新数据集，待落定版本不可见。"""
        manifests = [
            row for row in store.rows(VERSION_MODULE)
            if row["status"] in (VERSION_SETTLED, VERSION_PUBLISHED)
            and (view_code is None or str(row["视图编号"]) == view_code)
        ]
        if not manifests:
            return {"视图编号": view_code, "版本号": None, "items": [], "message": "尚无已落定数据集，拒绝采用待落定数据核对"}
        manifest = max(manifests, key=lambda row: int(row["版本号"]))
        items = [
            row for row in store.rows(MODULE)
            if int(row.get("版本号", 0)) == int(manifest["版本号"])
        ]
        return {
            "视图编号": manifest["视图编号"],
            "版本号": manifest["版本号"],
            "批次号": manifest["批次号"],
            "状态": manifest["status"],
            "落定时间": manifest["落定时间"],
            "字段范围": manifest["字段范围"],
            "items": items,
        }

    # ------------------------------------------------------------------ 查询
    def list_entries(
        self,
        *,
        version: int | None = None,
        view_code: str | None = None,
        row_type: str | None = None,
        page: int = 1,
        size: int = 20,
    ) -> tuple[list[dict[str, Any]], int]:
        rows = store.rows(MODULE)
        if version is not None:
            rows = [row for row in rows if int(row.get("版本号", 0)) == version]
        if view_code:
            rows = [row for row in rows if str(row.get("视图编号")) == view_code]
        if row_type:
            rows = [row for row in rows if row.get("行类型") == row_type]
        total = len(rows)
        start = max(page - 1, 0) * size
        return rows[start:start + size], total

    def list_versions(self) -> list[dict[str, Any]]:
        return sorted(store.rows(VERSION_MODULE), key=lambda row: -int(row["版本号"]))

    def list_notifications(self, view_code: str | None = None) -> list[dict[str, Any]]:
        rows = store.rows(NOTIFY_MODULE)
        if view_code:
            rows = [row for row in rows if str(row.get("视图编号")) == view_code]
        return sorted(rows, key=lambda row: -int(row.get("id", 0)))

    def view_metric_snapshot(self, view_code: str) -> dict[str, Any]:
        """给运营看板视图提供已发布的指标明细快照（看板列表/详情共用）。"""
        published = [
            row for row in store.rows(VERSION_MODULE)
            if str(row.get("视图编号")) == view_code and row["status"] == VERSION_PUBLISHED
        ]
        if not published:
            return {"视图编号": view_code, "版本号": None, "items": [], "notifications": []}
        manifest = max(published, key=lambda row: int(row["版本号"]))
        items = [
            row for row in store.rows(MODULE)
            if int(row.get("版本号", 0)) == int(manifest["版本号"])
        ]
        notifications = self.list_notifications(view_code)
        return {
            "视图编号": view_code,
            "版本号": manifest["版本号"],
            "批次号": manifest["批次号"],
            "字段范围": manifest["字段范围"],
            "发布时间": manifest["发布时间"],
            "items": items,
            "notifications": notifications,
        }

    # ------------------------------------------------------------------ 内部工具
    def _sync_notifications(
        self,
        view: dict[str, Any],
        manifest: dict[str, Any],
        merged_rows: list[dict[str, Any]],
        published_at: str,
    ) -> int:
        groups = [part.strip() for part in _SPLIT_RE.split(str(view.get("订阅接收组") or "")) if part.strip()]
        groups = groups or ["未配置订阅接收组"]
        table = store.rows(NOTIFY_MODULE)
        next_id = max((int(row.get("id", 0)) for row in table), default=0) + 1
        count = 0
        for group in groups:
            for row in merged_rows:
                table.append({
                    "id": next_id,
                    "通知编号": f"{NOTIFY_PREFIX}-{next_id:04d}",
                    "视图编号": view["视图编号"],
                    "版本号": manifest["版本号"],
                    "批次号": manifest["批次号"],
                    "关联实验": row["关联实验"],
                    "订阅接收组": group,
                    "告警线状态": row["告警线状态"],
                    "指标差异摘要": "；".join(row["指标差异"]),
                    "status": "已同步",
                    "pending": False,
                    "abnormal": row["告警线状态"] == "触发",
                    "通知时间": published_at,
                })
                next_id += 1
                count += 1
        return count

    def _diff_against_baseline(
        self,
        metrics: dict[str, float],
        baseline: dict[str, float],
        field_range: list[str],
        *,
        is_baseline: bool,
    ) -> list[str]:
        if is_baseline:
            return ["基准变体（同实验分流占比最低）"]
        diffs: list[str] = []
        for name in field_range:
            current = metrics[name]
            base = baseline.get(name)
            if base is None:
                diffs.append(f"{name}：基准缺失")
                continue
            absolute = current - base
            relative = (absolute / base * 100) if base else 0.0
            diffs.append(f"{name} 差异 {absolute:+.4g}（{relative:+.2f}%）")
        return diffs

    def _build_row(
        self,
        *,
        version: int,
        batch: str,
        view_code: str,
        generated_at: str,
        row_type: str,
        experiment: str,
        variant_code: str,
        variant_name: str,
        variant_status: str,
        ratio: float,
        window: str,
        metrics: dict[str, float],
        field_range: list[str],
        diffs: list[str],
        alarm_status: str,
        alarm_details: list[str],
        source_id: int,
        source_code: str,
        source_tag: str,
        remark: str | None,
    ) -> dict[str, Any]:
        return {
            "id": max((int(row.get("id", 0)) for row in store.rows(MODULE)), default=0) + 1,
            "版本号": version,
            "批次号": batch,
            "视图编号": view_code,
            "行类型": row_type,
            "关联实验": experiment,
            "变体编号": variant_code,
            "变体名称": variant_name,
            "变体状态": variant_status,
            "分流占比": ratio,
            "指标窗口": window,
            "指标组合": {name: metrics.get(name) for name in field_range},
            "指标差异": diffs,
            "告警线状态": alarm_status,
            "告警判定明细": alarm_details,
            "来源分流记录": source_code,
            "来源记录id": source_id,
            "来源标识": source_tag,
            "status": VERSION_DRAFT,
            "pending": True,
            "abnormal": alarm_status == "触发",
            "生成时间": generated_at,
            "落定时间": None,
            "发布时间": None,
            "备注": remark,
        }

    def _next_version(self) -> int:
        return max((int(row.get("id", 0)) for row in store.rows(VERSION_MODULE)), default=0) + 1

    def _find_manifest(self, version: int) -> dict[str, Any] | None:
        for row in store.rows(VERSION_MODULE):
            if int(row.get("id", 0)) == version:
                return row
        return None

    def _find_view(self, view_code: str) -> dict[str, Any] | None:
        for row in store.rows(DASHBOARD_MODULE):
            if str(row.get("视图编号")) == view_code:
                return row
        return None


abmetric_service = AbmetricService()
