"""Conservative, model-independent grouping for scene extraction.

A visual model must supply a relation and an observable reason. Geometry is only
an additional check: containment alone never creates a relation. The caller must
keep every source item/box so a grouping can be inspected or undone. This module
neither edits inventory nor establishes ownership or sharing permission.
"""

import math
import re
import unicodedata
from collections import defaultdict

_VERSION = 1
_POSITIVE = {"integrated-part", "same-object"}
_RELATIONS = _POSITIVE | {"separate", "uncertain"}


def _text(value):
    return unicodedata.normalize("NFKC", value).strip().casefold() if isinstance(value, str) else ""


def _english(text, pattern):
    return bool(re.search(r"\b(?:" + pattern + r")\b", text))


def _kind(name):
    name = _text(name)
    # A "laptop keyboard" names a keyboard. Match that before the computer,
    # and notebook computers before paper notebooks. Broad catalog categories
    # are not object identities.
    if "键盘" in name or _english(name, r"keyboards?"):
        return "keyboard"
    if "笔记本电脑" in name or _english(name, r"laptops?|notebook computers?"):
        return "laptop"
    if any(s in name for s in ("显示器", "显示屏")) or _english(name, r"monitors?|computer displays?"):
        return "monitor"
    if "鼠标" in name or _english(name, r"mouse|mice"):
        return "mouse"
    if "手机" in name or _english(name, r"phones?|smartphones?|mobile phones?"):
        return "phone"
    if "电脑" in name or _english(name, r"computers?|desktop computers?|pcs?"):
        return "computer"
    if any(s in name for s in ("书架", "货架", "置物架", "架子")) or _english(name, r"shel(?:f|ves)|bookcases?|racks?"):
        return "shelf"
    if "桌" in name or _english(name, r"tables?|desks?"):
        return "table"
    if any(s in name for s in ("水杯", "茶杯", "马克杯", "咖啡杯", "杯子")) or _english(name, r"cups?|mugs?"):
        return "cup"
    if any(s in name for s in ("书籍", "课本", "书本", "笔记本")) or name == "书" or _english(name, r"books?|notebooks?"):
        return "book"
    if "剪刀" in name or _english(name, r"scissors"):
        return "scissors"
    if "椅" in name or _english(name, r"chairs?"):
        return "chair"
    return None


def _external(name):
    name = _text(name)
    return any(s in name for s in ("外置", "外接", "独立", "无线", "蓝牙", "分离", "可拆卸")) or _english(
        name, r"external|standalone|stand-alone|separate|wireless|bluetooth|detachable"
    )


def _box(value):
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or not 0 <= n <= 1000 for n in value):
        return None
    x1, y1, x2, y2 = value
    return tuple(value) if x1 < x2 and y1 < y2 else None


def _area(box):
    return (box[2] - box[0]) * (box[3] - box[1])


def _intersection(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))


def _specific_evidence(value):
    """Require an observable description, not a relation label or a guess.

    This is a conservative syntax gate, not proof that a visual statement is
    true. Image review remains necessary; an LLM can still give a wrong reason.
    """
    value = _text(value)
    if len(re.sub(r"\s", "", value)) < 6:
        return False
    if any(s in value for s in ("不确定", "可能", "疑似", "推测", "猜测")) or _english(value, r"maybe|perhaps|probably|uncertain|guess(?:ed)?"):
        return False
    cues = ("内置", "嵌入", "面板", "机身", "外壳", "连接", "相连", "固定", "轮廓", "边缘", "纹理", "遮挡", "按键", "铰链", "手柄", "标识", "形状", "颜色", "同一位置", "同一物", "同一个物", "一体")
    return any(c in value for c in cues) or _english(value, r"built[ -]in|embedded|panel|chassis|housing|attached|connected|fixed|outline|edges?|texture|occlusion|keys?|hinge|handle|markings?|shape|colou?rs?|same position|same object|one piece")


def _same_type(a, b):
    left, right = _text(a.get("name")), _text(b.get("name"))
    generic = {"", "物品", "东西", "未知", "object", "item", "unknown", "other"}
    if left == right and left not in generic:
        return True
    left_kind, right_kind = _kind(left), _kind(right)
    return left_kind is not None and left_kind == right_kind


def _placement_pair(a, b):
    """Known placement/accessory pairs cannot be asserted to be one object."""
    kinds = {_kind(a.get("name")), _kind(b.get("name"))}
    if kinds in ({"cup", "table"}, {"book", "shelf"}):
        return True
    if ("mouse" in kinds or "phone" in kinds) and ("computer" in kinds or "laptop" in kinds):
        return True
    if kinds == {"keyboard", "monitor"}:
        return True
    return False


def _cycle_nodes(edges):
    """Find all nodes belonging to a directed cycle, without dependencies."""
    graph = defaultdict(set)
    for parent, child in edges:
        graph[parent].add(child)
    indices, low, stack, on_stack, cyclic = {}, {}, [], set(), set()

    def visit(node):
        indices[node] = low[node] = len(indices)
        stack.append(node)
        on_stack.add(node)
        for child in graph[node]:
            if child not in indices:
                visit(child)
                low[node] = min(low[node], low[child])
            elif child in on_stack:
                low[node] = min(low[node], indices[child])
        if low[node] == indices[node]:
            component = []
            while True:
                child = stack.pop()
                on_stack.remove(child)
                component.append(child)
                if child == node:
                    break
            if len(component) > 1:
                cyclic.update(component)

    for node in list(graph):
        if node not in indices:
            visit(node)
    return cyclic


def build_grouping(items, relations):
    """Return reversible grouping proposals; never mutate the supplied items.

    Only a visually supported, contained, single laptop/keyboard pair is applied
    by default. Unknown quantity can yield a proposal but needs confirmation.
    Other valid part relations and duplicate boxes always need confirmation.
    Invalid, conflicting, cyclic or multiply-parented claims fail closed.
    """
    notes = []

    def note(message):
        if message not in notes:
            notes.append(message)

    result = {"version": _VERSION, "proposals": [], "notes": notes}
    if not isinstance(items, list):
        note("物品列表格式无效，未生成合并提议。")
        return result
    by_id, duplicate_ids = {}, set()
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"].strip() or item["id"] != item["id"].strip():
            note("存在缺少有效 ID 的物品，相关关系不参与合并。")
            continue
        item_id = item["id"]
        if item_id in by_id:
            duplicate_ids.add(item_id)
        else:
            by_id[item_id] = item
    for item_id in sorted(duplicate_ids):
        by_id.pop(item_id, None)
        note(f"物品 ID {item_id} 重复，相关关系不参与合并。")
    if not isinstance(relations, list):
        note("视觉关系列表格式无效，未生成合并提议。")
        return result

    valid = []
    for index, relation in enumerate(relations):
        if not isinstance(relation, dict):
            note(f"关系 {index + 1} 格式无效，已跳过。")
            continue
        parent, child, kind = relation.get("parentId"), relation.get("childId"), relation.get("relation")
        if not isinstance(parent, str) or not isinstance(child, str) or parent not in by_id or child not in by_id:
            note(f"关系 {index + 1} 引用了不存在或不唯一的物品，已跳过。")
            continue
        if parent == child:
            note(f"关系 {index + 1} 引用了物品自身，已跳过。")
            continue
        if not isinstance(kind, str) or kind not in _RELATIONS:
            note(f"关系 {index + 1} 的类型无效，已跳过。")
            continue
        valid.append((parent, child, kind, relation.get("evidence")))

    # Check ambiguity before filtering on geometry or evidence. Choosing the
    # nicest of two contradictory claims would hide the model's uncertainty.
    pair_kinds = defaultdict(set)
    positive_edges = set()
    parents = defaultdict(set)
    for parent, child, kind, _ in valid:
        pair_kinds[frozenset((parent, child))].add(kind)
        if kind in _POSITIVE:
            positive_edges.add((parent, child))
            parents[child].add(parent)
    conflicted_pairs = {pair for pair, kinds in pair_kinds.items() if kinds & _POSITIVE and (len(kinds) > 1)}
    multiply_parented = {child for child, parent_ids in parents.items() if len(parent_ids) > 1}
    cyclic = _cycle_nodes(positive_edges)
    if conflicted_pairs:
        note("视觉关系存在冲突（含分开、未知或不同关系判断），相关物品对不合并。")
    if multiply_parented:
        note("同一物品有多个父物品，相关关系不合并：" + "、".join(sorted(multiply_parented)) + "。")
    if cyclic:
        note("视觉关系形成循环，涉及循环的物品不合并：" + "、".join(sorted(cyclic)) + "。")

    accepted = {}
    for parent, child, kind, evidence in valid:
        if kind not in _POSITIVE:
            note(f"{parent} → {child} 的视觉判断为{'独立物品' if kind == 'separate' else '关系未知'}，保留分开。")
            continue
        if frozenset((parent, child)) in conflicted_pairs or child in multiply_parented or parent in cyclic or child in cyclic:
            continue
        label = f"{parent} → {child}"
        if not _specific_evidence(evidence):
            note(f"{label} 缺少具体、明确的视觉依据，未合并。")
            continue
        a, b = by_id[parent], by_id[child]
        parent_box, child_box = _box(a.get("bbox")), _box(b.get("bbox"))
        if parent_box is None or child_box is None:
            note(f"{label} 的框无效或缺失，未合并。")
            continue
        quantities = (a.get("visibleQuantity"), b.get("visibleQuantity"))
        if any(q is not None and (isinstance(q, bool) or not isinstance(q, int) or q < 1 or q > 1) for q in quantities):
            note(f"{label} 含多件或无效数量，未合并；不能把集合框压成一件。")
            continue
        if kind == "same-object":
            intersection = _intersection(parent_box, child_box)
            iou = intersection / (_area(parent_box) + _area(child_box) - intersection)
            if not _same_type(a, b) or iou + 1e-12 < 0.85:
                note(f"{label} 不满足同名或同类型及 IoU ≥ 0.85 的重复框条件，未合并。")
                continue
            automatic = False
        else:
            if _placement_pair(a, b) or (_kind(b.get("name")) == "keyboard" and _external(b.get("name"))):
                note(f"{label} 属于常见放置、配件或明确外置关系，未合并。")
                continue
            if _area(parent_box) < _area(child_box) or _intersection(parent_box, child_box) / _area(child_box) + 1e-12 < 0.8:
                note(f"{label} 不满足整件框包含部件至少 80% 的几何校验，未合并。")
                continue
            automatic = (_kind(a.get("name")) == "laptop" and _kind(b.get("name")) == "keyboard" and all(q == 1 for q in quantities))
        key = (parent, kind, automatic)
        if key not in accepted:
            accepted[key] = {"parentId": parent, "childIds": [], "relation": kind, "evidence": [], "applyByDefault": automatic}
        proposal = accepted[key]
        if child not in proposal["childIds"]:
            proposal["childIds"].append(child)
        cleaned = evidence.strip()
        if cleaned not in proposal["evidence"]:
            proposal["evidence"].append(cleaned)
        if None in quantities:
            note(f"{label} 的数量尚未知，关系提议需要用户确认。")
    for proposal in accepted.values():
        proposal["evidence"] = "；".join(proposal["evidence"])
        result["proposals"].append(proposal)
    return result
