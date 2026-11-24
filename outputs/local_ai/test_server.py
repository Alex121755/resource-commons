import copy
import base64
import io
import json
from email.message import Message
from unittest import TestCase, main
from unittest.mock import patch
import server

def sample():
    return {"purpose":"拍桌面视频", "needs":[{"id":"phone","label":"手机支架","sourceText":"3套手机支架","quantity":3,"phoneWidthMm":80,"phoneWeightG":250}],
            "startLocal":"2026-11-05T14:00","endLocal":"2026-11-05T17:00","allowAlternatives":True,"missingQuestions":["是否接受替代？"],
            "evidence":[{"field":"quantity","quote":"3套手机支架"}]}

TEXT = "需要3套手机支架，手机宽80毫米，重250克。2026年11月5日14:00到17:00，可以替代。"
IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ3sAAAAASUVORK5CYII="

def scene_sample():
    return {"items": [
        {"id": "model-a", "name": "笔记本电脑", "category": "electronics",
         "bbox": [50, 100, 600, 850], "visibleQuantity": 1,
         "visibleText": "", "uncertainties": ["型号标签未看清"]},
        {"id": "model-b", "name": "剪刀", "category": "tools",
         "bbox": [650, 200, 950, 700], "visibleQuantity": 1,
         "visibleText": "", "uncertainties": []}], "sceneNotes": []}

class AdapterTests(TestCase):
    def run_model(self, data, text=TEXT):
        with patch.object(server, "ollama_json", return_value={"message":{"content":json.dumps(data)},"done_reason":"stop"}):
            return server.extract("request", {"text":text})["data"]

    def test_valid_schema(self):
        server.validate_schema(sample(), server.REQUEST_SCHEMA)

    def test_extra_permission_field_rejected(self):
        d=sample();d["approved"]=True
        with self.assertRaises(ValueError): self.run_model(d)

    def test_bool_is_not_quantity(self):
        d=sample();d["needs"][0]["quantity"]=True
        with self.assertRaises(ValueError): self.run_model(d)

    def test_missing_evidence_field_rejected(self):
        d=sample();del d["needs"][0]["sourceText"]
        with self.assertRaises(ValueError): self.run_model(d)

    def test_ungrounded_need_removed(self):
        d=sample();d["needs"].append({"id":"chair","label":"椅子","sourceText":"四把椅子","quantity":4,"phoneWidthMm":None,"phoneWeightG":None})
        self.assertEqual(len(self.run_model(d)["needs"]),1)

    def test_wrong_category_for_quote_removed(self):
        d=sample();d["needs"][0]["id"]="chair"
        self.assertEqual(self.run_model(d)["needs"],[])

    def test_fabricated_global_quote_removed(self):
        d=sample();d["evidence"].append({"field":"owner","quote":"管理员批准"})
        self.assertEqual(len(self.run_model(d)["evidence"]),1)

    def test_unknown_quantity_remains_null(self):
        d=sample();d["needs"][0]["quantity"]=None
        out=self.run_model(d)
        self.assertIsNone(out["needs"][0]["quantity"])
        self.assertTrue(any("多少" in q for q in out["missingQuestions"]))

    def test_complete_fields_no_repeat_question(self):
        self.assertEqual(self.run_model(sample())["missingQuestions"],[])

    def test_invalid_calendar_becomes_unknown(self):
        d=sample();d["startLocal"]="2026-02-30T14:00"
        self.assertIsNone(self.run_model(d)["startLocal"])

    def test_inverted_interval_requires_end(self):
        d=sample();d["endLocal"]="2026-11-05T13:00"
        self.assertIsNone(self.run_model(d)["endLocal"])

    def test_negative_quantity_rejected(self):
        d=sample();d["needs"][0]["quantity"]=-2
        with self.assertRaises(ValueError): self.run_model(d)

    def test_unsupported_need_preserved(self):
        d=sample();d["needs"][0].update(id="unsupported",label="投影仪",sourceText="2个投影仪",quantity=2)
        self.assertEqual(self.run_model(d,"需要2个投影仪")["needs"][0]["id"],"unsupported")

    def test_empty_input_rejected_before_call(self):
        with self.assertRaises(ValueError): server.extract("request",{"text":" "})

    def test_remote_image_url_rejected(self):
        with self.assertRaises(ValueError): server.extract("item",{"image":"https://example.com/private.jpg"})

    def test_model_output_cannot_write_inventory(self):
        with patch.object(server,"ollama_json",return_value={"message":{"content":json.dumps(sample())},"done_reason":"stop"}):
            result=server.extract("request",{"text":TEXT})
        self.assertTrue(result["requiresHumanConfirmation"])
        self.assertNotIn("approved",result["data"])


class SceneTests(TestCase):
    def run_scene(self, data, body=None, done_reason="stop"):
        with patch.object(server, "ollama_json", return_value={
                "message": {"content": json.dumps(data)}, "done_reason": done_reason}):
            return server.extract("scene", body or {"image": IMAGE, "text": "请记录桌上物品"})

    def test_two_objects_retained_with_distinct_response_ids(self):
        out = self.run_scene(scene_sample())
        self.assertEqual([i["name"] for i in out["data"]["items"]], ["笔记本电脑", "剪刀"])
        self.assertEqual([i["id"] for i in out["data"]["items"]], ["scene-001", "scene-002"])
        self.assertTrue(out["localOnly"])
        self.assertTrue(out["requiresHumanConfirmation"])
        self.assertEqual(out["model"], server.MODEL)
        self.assertGreaterEqual(out["elapsedSeconds"], 0)

    def test_all_seven_scene_categories_supported(self):
        for category in server.SCENE_CATEGORIES:
            with self.subTest(category=category):
                d = scene_sample(); d["items"][0]["category"] = category
                self.assertEqual(self.run_scene(d)["data"]["items"][0]["category"], category)

    def test_old_inventory_category_is_not_scene_category(self):
        d = scene_sample(); d["items"][0]["category"] = "tripod"
        with self.assertRaisesRegex(ValueError, "允许范围"):
            self.run_scene(d)

    def test_duplicate_ids_canonicalized_without_removing_items(self):
        d = scene_sample(); d["items"][1]["id"] = d["items"][0]["id"]
        items = self.run_scene(d)["data"]["items"]
        self.assertEqual(len(items), 2)
        self.assertEqual(len({i["id"] for i in items}), 2)

    def test_null_bbox_and_quantity_stay_unknown(self):
        d = scene_sample(); d["items"][0].update(bbox=None, visibleQuantity=None, name=None)
        item = self.run_scene(d)["data"]["items"][0]
        self.assertIsNone(item["bbox"])
        self.assertIsNone(item["visibleQuantity"])
        self.assertIsNone(item["name"])

    def test_invalid_boxes_become_null_with_explanation(self):
        boxes = [[-1, 2, 10, 20], [0, 0, 1001, 1000], [50, 10, 50, 90],
                 [60, 20, 10, 80], [0, 0, 10], [0, 0, 10, 20, 30],
                 [float("nan"), 0, 50, 50], [0, 0, float("inf"), 50],
                 [True, 0, 50, 50], ["1", 0, 50, 50], "0,0,50,50",
                 [10**500, 0, 50, 50]]
        for bbox in boxes:
            with self.subTest(bbox=bbox):
                d = scene_sample(); d["items"][0]["bbox"] = bbox
                item = self.run_scene(d)["data"]["items"][0]
                self.assertIsNone(item["bbox"])
                self.assertTrue(any("已取消裁切" in x for x in item["uncertainties"]))

    def test_valid_edge_box_preserved_without_inventing_padding(self):
        d = scene_sample(); d["items"][0]["bbox"] = [0, 0.25, 1000, 999.75]
        self.assertEqual(self.run_scene(d)["data"]["items"][0]["bbox"], [0, 0.25, 1000, 999.75])

    def test_invalid_quantities_become_unknown(self):
        for quantity in [0, -1, 1001, 10**500]:
            with self.subTest(quantity=quantity):
                d = scene_sample(); d["items"][0]["visibleQuantity"] = quantity
                item = self.run_scene(d)["data"]["items"][0]
                self.assertIsNone(item["visibleQuantity"])
                self.assertTrue(any("数量" in x for x in item["uncertainties"]))

    def test_boolean_quantity_rejected(self):
        d = scene_sample(); d["items"][0]["visibleQuantity"] = True
        with self.assertRaises(ValueError): self.run_scene(d)

    def test_twelve_items_allowed_and_thirteen_explicitly_rejected(self):
        d = scene_sample(); d["items"] = [copy.deepcopy(d["items"][0]) for _ in range(12)]
        self.assertEqual(len(self.run_scene(d)["data"]["items"]), 12)
        d["items"].append(copy.deepcopy(d["items"][0]))
        with self.assertRaisesRegex(ValueError, "没有截断清单"):
            self.run_scene(d)

    def test_extra_item_authority_or_state_fields_rejected(self):
        for field in ["owner", "location", "permissions", "approved", "condition", "specs"]:
            with self.subTest(field=field):
                d = scene_sample(); d["items"][0][field] = "模型不得决定"
                with self.assertRaisesRegex(ValueError, "未允许字段"): self.run_scene(d)

    def test_extra_top_level_permission_rejected(self):
        d = scene_sample(); d["approved"] = True
        with self.assertRaisesRegex(ValueError, "未允许字段"): self.run_scene(d)

    def test_input_permission_rejected_before_model_call(self):
        with patch.object(server, "ollama_json") as model:
            with self.assertRaisesRegex(ValueError, "不接受授权"):
                server.extract("scene", {"image": IMAGE, "approved": True})
            model.assert_not_called()

    def test_missing_required_box_rejected(self):
        d = scene_sample(); del d["items"][0]["bbox"]
        with self.assertRaisesRegex(ValueError, "必填字段"): self.run_scene(d)

    def test_empty_scene_preserved_with_notes(self):
        d = {"items": [], "sceneNotes": ["图片模糊，没有可辨主体，请补拍。"]}
        self.assertEqual(self.run_scene(d)["data"], d)

    def test_local_image_and_scene_token_budget_sent_to_real_adapter(self):
        with patch.object(server, "ollama_json", return_value={
                "message": {"content": json.dumps(scene_sample())}, "done_reason": "stop"}) as model:
            server.extract("scene", {"image": IMAGE})
            path, payload = model.call_args.args
            self.assertEqual(path, "/api/chat")
            self.assertEqual(payload["messages"][1]["images"], [IMAGE.split(",", 1)[1]])
            self.assertEqual(payload["format"], server.SCENE_SCHEMA)
            self.assertEqual(payload["options"]["num_predict"], 2300)
            self.assertEqual(payload["options"]["num_ctx"], 6144)
            self.assertFalse(payload["think"])

    def test_remote_image_and_bad_base64_rejected_before_call(self):
        for image in ["https://example.com/photo.png", "data:image/png;base64,abc==", "", "data:text/html;base64,SGk="]:
            with self.subTest(image=image), patch.object(server, "ollama_json") as model:
                with self.assertRaises(ValueError): server.extract("scene", {"image": image})
                model.assert_not_called()

    def test_decoded_image_over_three_mb_rejected_before_call(self):
        image = "data:image/png;base64," + base64.b64encode(b"x" * 3_000_001).decode()
        with patch.object(server, "ollama_json") as model:
            with self.assertRaisesRegex(ValueError, "超过3MB"):
                server.extract("scene", {"image": image})
            model.assert_not_called()

    def test_truncated_model_reply_never_returned_as_complete(self):
        with self.assertRaisesRegex(ValueError, "不完整"):
            self.run_scene(scene_sample(), done_reason="length")

    def test_lock_released_after_bad_scene_output(self):
        d = scene_sample(); d["approved"] = True
        with self.assertRaises(ValueError): self.run_scene(d)
        self.assertFalse(server.MODEL_LOCK.locked())
        self.assertEqual(len(self.run_scene(scene_sample())["data"]["items"]), 2)

    def test_existing_item_endpoint_keeps_its_schema(self):
        d = {"name": "椅子", "category": "chair", "visibleQuantity": 1,
             "visibleText": "", "specSuggestions": [], "uncertainties": []}
        with patch.object(server, "ollama_json", return_value={
                "message": {"content": json.dumps(d)}, "done_reason": "stop"}):
            self.assertEqual(server.extract("item", {"image": IMAGE})["data"], d)

    def test_scene_http_route_dispatches_without_starting_server(self):
        body = json.dumps({"image": IMAGE}).encode()
        h = object.__new__(server.Handler)
        h.path = "/api/extract-scene"
        h.headers = Message(); h.headers["Content-Length"] = str(len(body)); h.headers["Content-Type"] = "application/json"
        h.rfile = io.BytesIO(body)
        responses = []
        h.permitted = lambda: True
        h.json_response = lambda status, value: responses.append((status, value))
        with patch.object(server, "extract", return_value={"data": scene_sample()}) as extract:
            h.do_POST()
            extract.assert_called_once_with("scene", {"image": IMAGE})
        self.assertEqual(responses[0][0], 200)

if __name__=="__main__": main()
