"""Boundary checks for reversible, visually supported scene grouping."""
import copy
import math
import unittest

from grouping_policy import build_grouping


def item(item_id, name, bbox=None, quantity=1, category="electronics"):
    return {"id": item_id, "name": name, "bbox": bbox if bbox is not None else [0, 0, 1000, 1000],
            "visibleQuantity": quantity, "category": category,
            "visibleText": "", "uncertainties": []}


def relation(parent="laptop", child="keyboard", kind="integrated-part", evidence="键盘的按键嵌入笔记本电脑的机身面板内，外壳连续相连。"):
    return {"parentId": parent, "childId": child, "relation": kind, "evidence": evidence}


def laptop_pair(keyboard_name="内置键盘", child_box=None, parent_quantity=1, child_quantity=1):
    return [item("laptop", "笔记本电脑", [0, 0, 1000, 1000], parent_quantity),
            item("keyboard", keyboard_name, child_box or [200, 600, 800, 900], child_quantity)]


class GroupingPolicyTests(unittest.TestCase):
    def proposal(self, items=None, relations=None):
        return build_grouping(items if items is not None else laptop_pair(), relations if relations is not None else [relation()])

    def test_internal_keyboard_automatically_groups(self):
        result = self.proposal()
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["proposals"][0], {"parentId": "laptop", "childIds": ["keyboard"],
                         "relation": "integrated-part", "evidence": relation()["evidence"], "applyByDefault": True})

    def test_english_names_recognized(self):
        items = laptop_pair("keyboard")
        items[0]["name"] = "Silver Notebook Computer"
        self.assertTrue(self.proposal(items)["proposals"][0]["applyByDefault"])

    def test_laptop_keyboard_name_is_a_part_not_another_computer(self):
        for name in ("笔记本电脑键盘", "Laptop keyboard"):
            with self.subTest(name=name):
                self.assertTrue(self.proposal(laptop_pair(name))["proposals"][0]["applyByDefault"])

    def test_plain_paper_notebook_does_not_auto_group_keyboard(self):
        items = laptop_pair()
        items[0]["name"] = "笔记本"
        self.assertFalse(self.proposal(items)["proposals"][0]["applyByDefault"])

    def test_generic_laptop_keyboard_uses_explicit_visual_relation(self):
        self.assertTrue(self.proposal(laptop_pair("电脑键盘"))["proposals"][0]["applyByDefault"])

    def test_containment_without_relations_never_groups(self):
        self.assertEqual(self.proposal(relations=[])["proposals"], [])

    def test_overlapping_external_keyboard_does_not_group(self):
        for name in ("外置键盘", "外接键盘", "独立键盘", "无线键盘", "蓝牙键盘", "External keyboard", "Wireless keyboard", "Bluetooth keyboard", "detachable keyboard"):
            with self.subTest(name=name):
                result = self.proposal(laptop_pair(name))
                self.assertEqual(result["proposals"], [])
                self.assertTrue(result["notes"])

    def test_nonoverlapping_keyboard_does_not_group(self):
        items = [item("laptop", "笔记本电脑", [0, 0, 400, 400]), item("keyboard", "键盘", [600, 600, 900, 900])]
        self.assertEqual(self.proposal(items)["proposals"], [])

    def test_exact_80_percent_containment_passes(self):
        items = [item("laptop", "笔记本电脑", [0, 0, 800, 1000]), item("keyboard", "内置键盘", [0, 700, 1000, 900])]
        self.assertTrue(self.proposal(items)["proposals"][0]["applyByDefault"])

    def test_below_80_percent_containment_fails(self):
        items = [item("laptop", "笔记本电脑", [0, 0, 799, 1000]), item("keyboard", "内置键盘", [0, 700, 1000, 900])]
        self.assertEqual(self.proposal(items)["proposals"], [])

    def test_parent_area_smaller_than_child_fails(self):
        items = [item("laptop", "笔记本电脑", [0, 0, 800, 800]), item("keyboard", "键盘", [0, 0, 1000, 800])]
        self.assertEqual(self.proposal(items)["proposals"], [])

    def test_separate_relation_preserves_overlapping_items(self):
        result = self.proposal(relations=[relation(kind="separate")])
        self.assertEqual(result["proposals"], [])
        self.assertIn("独立物品", " ".join(result["notes"]))

    def test_uncertain_relation_does_not_group(self):
        result = self.proposal(relations=[relation(kind="uncertain")])
        self.assertEqual(result["proposals"], [])
        self.assertIn("未知", " ".join(result["notes"]))

    def test_bad_boxes_fail_closed(self):
        bad_boxes = (None, [], [0, 0, 0, 100], [100, 0, 10, 100], [-1, 0, 100, 100], [0, 0, 1001, 100],
                     [True, 0, 100, 100], [0, 0, math.nan, 100], [0, 0, math.inf, 100], [0, 0, "100", 100])
        for box in bad_boxes:
            with self.subTest(box=box):
                items = laptop_pair()
                items[1]["bbox"] = box
                self.assertEqual(self.proposal(items)["proposals"], [])

    def test_missing_bbox_fails_closed(self):
        items = laptop_pair()
        del items[1]["bbox"]
        self.assertEqual(self.proposal(items)["proposals"], [])

    def test_missing_reference_fails_closed(self):
        result = self.proposal(relations=[relation(child="missing")])
        self.assertEqual(result["proposals"], [])
        self.assertIn("引用", " ".join(result["notes"]))

    def test_self_reference_fails_closed(self):
        self.assertEqual(self.proposal(relations=[relation(child="laptop")])["proposals"], [])

    def test_duplicate_item_id_is_ambiguous(self):
        items = laptop_pair() + [item("laptop", "另一台笔记本电脑")]
        result = self.proposal(items)
        self.assertEqual(result["proposals"], [])
        self.assertIn("重复", " ".join(result["notes"]))

    def test_cycle_fails_without_choosing_direction(self):
        result = self.proposal(relations=[relation(), relation("keyboard", "laptop")])
        self.assertEqual(result["proposals"], [])
        self.assertIn("循环", " ".join(result["notes"]))

    def test_longer_cycle_fails(self):
        items = laptop_pair() + [item("third", "电脑外壳")]
        result = self.proposal(items, [relation(), relation("keyboard", "third"), relation("third", "laptop")])
        self.assertEqual(result["proposals"], [])
        self.assertIn("循环", " ".join(result["notes"]))

    def test_multiple_parents_fails_without_picking_largest_box(self):
        items = laptop_pair() + [item("second", "另一台笔记本电脑")]
        result = self.proposal(items, [relation(), relation("second", "keyboard")])
        self.assertEqual(result["proposals"], [])
        self.assertIn("多个父", " ".join(result["notes"]))

    def test_relation_conflict_fails_in_both_orders(self):
        for kinds in (("integrated-part", "separate"), ("uncertain", "integrated-part"), ("integrated-part", "same-object")):
            with self.subTest(kinds=kinds):
                result = self.proposal(relations=[relation(kind=k) for k in kinds])
                self.assertEqual(result["proposals"], [])
                self.assertIn("冲突", " ".join(result["notes"]))

    def test_reversed_negative_relation_also_blocks(self):
        result = self.proposal(relations=[relation(), relation("keyboard", "laptop", "separate")])
        self.assertEqual(result["proposals"], [])

    def test_unknown_quantity_never_becomes_one_or_auto_applied(self):
        for parent_quantity, child_quantity in ((None, 1), (1, None), (None, None)):
            with self.subTest(parent=parent_quantity, child=child_quantity):
                items = laptop_pair(parent_quantity=parent_quantity, child_quantity=child_quantity)
                before = copy.deepcopy(items)
                result = self.proposal(items)
                self.assertFalse(result["proposals"][0]["applyByDefault"])
                self.assertEqual(items, before)
                self.assertIn("数量尚未知", " ".join(result["notes"]))

    def test_multiple_or_invalid_quantity_never_groups(self):
        for quantity in (2, 5, 0, -1, True, 1.0, "1"):
            for idx in (0, 1):
                with self.subTest(quantity=quantity, idx=idx):
                    items = laptop_pair()
                    items[idx]["visibleQuantity"] = quantity
                    self.assertEqual(self.proposal(items)["proposals"], [])

    def test_common_placement_pairs_are_denied_even_with_wrong_model_relation(self):
        pairs = (("书桌", "水杯"), ("Table", "Mug"), ("书架", "书本"), ("Shelf", "Book"),
                 ("电脑", "鼠标"), ("Laptop", "Mouse"), ("电脑", "手机"), ("Computer", "Phone"),
                 ("显示器", "外置键盘"), ("Monitor", "External Keyboard"))
        for parent, child in pairs:
            with self.subTest(parent=parent, child=child):
                items = [item("laptop", parent), item("keyboard", child, [100, 100, 400, 400])]
                self.assertEqual(self.proposal(items)["proposals"], [])

    def test_other_credible_part_relation_requires_confirmation(self):
        items = [item("laptop", "玩具车"), item("keyboard", "车轮", [100, 100, 300, 300])]
        result = self.proposal(items, [relation(evidence="车轮通过轴连接在玩具车外壳内，固定点可见。")])
        self.assertEqual(len(result["proposals"]), 1)
        self.assertFalse(result["proposals"][0]["applyByDefault"])

    def test_same_object_requires_same_type_and_high_iou(self):
        items = [item("laptop", "剪刀", [0, 0, 1000, 1000], category="tools"),
                 item("keyboard", "黑色 scissors", [0, 0, 950, 1000], category="tools")]
        result = self.proposal(items, [relation(kind="same-object", evidence="两个框覆盖同一把剪刀的金属边缘和黑色手柄。")])
        self.assertFalse(result["proposals"][0]["applyByDefault"])

    def test_same_name_duplicate_at_exact_iou_threshold_passes(self):
        items = [item("laptop", "红色收纳盒"), item("keyboard", "红色收纳盒", [0, 0, 850, 1000])]
        result = self.proposal(items, [relation(kind="same-object", evidence="两个框覆盖同一物品的红色外壳和边缘。")])
        self.assertEqual(len(result["proposals"]), 1)

    def test_duplicate_below_iou_threshold_fails(self):
        items = [item("laptop", "剪刀"), item("keyboard", "剪刀", [0, 0, 849, 1000])]
        self.assertEqual(self.proposal(items, [relation(kind="same-object")])["proposals"], [])

    def test_same_category_does_not_mean_same_object(self):
        items = [item("laptop", "手机"), item("keyboard", "鼠标")]
        self.assertEqual(self.proposal(items, [relation(kind="same-object")])["proposals"], [])

    def test_different_overlapping_objects_never_merge_as_duplicate(self):
        self.assertEqual(self.proposal(relations=[relation(kind="same-object")])["proposals"], [])

    def test_identical_names_and_boxes_but_separate_relation_stay_separate(self):
        items = [item("laptop", "书"), item("keyboard", "书")]
        self.assertEqual(self.proposal(items, [relation(kind="separate")])["proposals"], [])

    def test_unknown_generic_names_cannot_prove_duplicate_identity(self):
        for name in (None, "物品", "unknown", "object"):
            with self.subTest(name=name):
                items = [item("laptop", name), item("keyboard", name)]
                self.assertEqual(self.proposal(items, [relation(kind="same-object")])["proposals"], [])

    def test_empty_generic_or_speculative_evidence_fails(self):
        for evidence in (None, "", " ", "是", "这是一个部件", "integrated-part", "可能内置在面板", "probably attached to chassis"):
            with self.subTest(evidence=evidence):
                self.assertEqual(self.proposal(relations=[relation(evidence=evidence)])["proposals"], [])

    def test_specific_english_visual_evidence_passes(self):
        result = self.proposal(relations=[relation(evidence="The keyboard is embedded in the continuous laptop chassis panel.")])
        self.assertTrue(result["proposals"][0]["applyByDefault"])

    def test_duplicate_relations_produce_one_child_and_one_evidence(self):
        result = self.proposal(relations=[relation(), relation()])
        self.assertEqual(len(result["proposals"]), 1)
        self.assertEqual(result["proposals"][0]["childIds"], ["keyboard"])
        self.assertEqual(result["proposals"][0]["evidence"], relation()["evidence"])

    def test_independent_valid_pair_survives_unrelated_cycle(self):
        items = laptop_pair() + [item("x", "配件一"), item("y", "配件二")]
        result = self.proposal(items, [relation(), relation("x", "y"), relation("y", "x")])
        self.assertEqual(result["proposals"][0]["parentId"], "laptop")
        self.assertEqual(len(result["proposals"]), 1)

    def test_no_mutation_of_items_or_relations(self):
        items, relations = laptop_pair(), [relation()]
        before = copy.deepcopy((items, relations))
        self.proposal(items, relations)
        self.assertEqual((items, relations), before)

    def test_malformed_input_fails_closed_without_crashing(self):
        for items, relations in ((None, []), ({}, []), ([], None), ([], {}), (laptop_pair(), [None]),
                                 (laptop_pair(), [{"parentId": [], "childId": "keyboard", "relation": "integrated-part"}]),
                                 (laptop_pair(), [relation(kind=[])])):
            with self.subTest(items=items, relations=relations):
                self.assertEqual(build_grouping(items, relations)["proposals"], [])


if __name__ == "__main__":
    unittest.main()
