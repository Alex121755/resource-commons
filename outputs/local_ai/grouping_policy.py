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
    patterns = (
        ("keyboard", r"keyboards?"),
        ("laptop", r"laptops?|notebook computers?"),
        ("monitor", r"monitors?|screens?|computer displays?"),
        ("mouse", r"mouse|mice"),
        ("phone", r"phones?|smartphones?"),
        ("computer", r"computers?|pcs?"),
        ("shelf", r"shel(?:f|ves)|bookshel(?:f|ves)|bookcases?|racks?"),
        ("table", r"tables?|desks?"),
        ("cup", r"cups?|teacups?|mugs?"),
        ("book", r"books?|textbooks?|notebooks?"),
        ("scissors", r"scissors"),
        ("chair", r"chairs?"),
    )
    for kind, pattern in patterns:
        if _english(name, pattern):
            return kind
    return None


def _external(name):
    return _english(_text(name), r"external|stand[ -]?alone|separate|wireless|bluetooth|detachable")


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
    if _english(value, r"maybe|perhaps|probably|possibly|uncertain|guess(?:ed)?"):
        return False
    return _english(
        value,
        r"built[ -]in|embedded|panels?|chassis|housing|attached|connected|fixed|outlines?|"
        r"edges?|textures?|occlusion|keys?|hinges?|handles?|markings?|shapes?|colou?rs?|"
        r"same position|same object|one piece",
    )


def _same_type(a, b):
    left, right = _text(a.get("name")), _text(b.get("name"))
    generic = {"", "item", "thing", "unknown", "object", "other"}
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
        note("Invalid item list. No grouping available.")
        return result
    by_id, duplicate_ids = {}, set()
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"].strip() or item["id"] != item["id"].strip():
            note("An item is missing a valid ID. Its relationships were skipped.")
            continue
        item_id = item["id"]
        if item_id in by_id:
            duplicate_ids.add(item_id)
        else:
            by_id[item_id] = item
    for item_id in sorted(duplicate_ids):
        by_id.pop(item_id, None)
        note(f"Item ID {item_id} is duplicated. Its relationships were skipped.")
    if not isinstance(relations, list):
        note("Invalid relationship list. No grouping available.")
        return result

    valid = []
    for index, relation in enumerate(relations):
        if not isinstance(relation, dict):
            note(f"Relationship {index + 1} has an invalid format and was skipped.")
            continue
        parent, child, kind = relation.get("parentId"), relation.get("childId"), relation.get("relation")
        if not isinstance(parent, str) or not isinstance(child, str) or parent not in by_id or child not in by_id:
            note(f"Relationship {index + 1} references a missing or ambiguous item ID and was skipped.")
            continue
        if parent == child:
            note(f"Relationship {index + 1} references itself and was skipped.")
            continue
        if not isinstance(kind, str) or kind not in _RELATIONS:
            note(f"Relationship {index + 1} has an invalid type and was skipped.")
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
        note("The visual assessments conflict. These items remain separate.")
    if multiply_parented:
        note("An item has multiple parents. Skipping relationships for " + ", ".join(sorted(multiply_parented)) + ".")
    if cyclic:
        note("The visual relationships contain a cycle. Keeping these items separate: " + ", ".join(sorted(cyclic)) + ".")

    accepted = {}
    for parent, child, kind, evidence in valid:
        if kind not in _POSITIVE:
            note(f"{parent} → {child} was assessed as {'separate objects' if kind == 'separate' else 'an unknown relationship'}. The items remain separate.")
            continue
        if frozenset((parent, child)) in conflicted_pairs or child in multiply_parented or parent in cyclic or child in cyclic:
            continue
        label = f"{parent} → {child}"
        if not _specific_evidence(evidence):
            note(f"{label} lacks specific visual evidence for grouping.")
            continue
        a, b = by_id[parent], by_id[child]
        parent_box, child_box = _box(a.get("bbox")), _box(b.get("bbox"))
        if parent_box is None or child_box is None:
            note(f"{label} has an invalid or missing box. Keeping the items separate.")
            continue
        quantities = (a.get("visibleQuantity"), b.get("visibleQuantity"))
        if any(q is not None and (isinstance(q, bool) or not isinstance(q, int) or q < 1 or q > 1) for q in quantities):
            note(f"{label} includes multiple items or an invalid quantity. Keeping the original candidates.")
            continue
        if kind == "same-object":
            intersection = _intersection(parent_box, child_box)
            iou = intersection / (_area(parent_box) + _area(child_box) - intersection)
            if not _same_type(a, b) or iou + 1e-12 < 0.85:
                note(f"{label} does not match the duplicate-box criteria (same name or type and IoU of at least 0.85).")
                continue
            automatic = False
        else:
            if _placement_pair(a, b) or (_kind(b.get("name")) == "keyboard" and _external(b.get("name"))):
                note(f"{label} appears to be a placement or accessory relationship. Keeping the items separate.")
                continue
            if _area(parent_box) < _area(child_box) or _intersection(parent_box, child_box) / _area(child_box) + 1e-12 < 0.8:
                note(f"{label} does not meet the 80% component containment threshold.")
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
            note(f"{label} has an unknown quantity. Review the proposed relationship.")
    for proposal in accepted.values():
        proposal["evidence"] = " / ".join(proposal["evidence"])
        result["proposals"].append(proposal)
    return result
