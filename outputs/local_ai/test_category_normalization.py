"""Catalog categories are stable while visual evidence and draft state remain intact."""
import copy,json,unittest
from unittest.mock import patch
import server

class CategoryNormalizationTests(unittest.TestCase):
 def item(self,name,category='stationery'):
  return {'id':'draft-1','name':name,'category':category,'bbox':[10,20,300,400],
   'visibleQuantity':None,'visibleText':'','uncertainties':['遮挡数量待核对']}
 def check(self,name,old,new):
  i=self.item(name,old);before=copy.deepcopy(i);changes=server.normalize_scene_categories([i]);self.assertEqual(i['category'],new)
  self.assertEqual({k:v for k,v in i.items() if k!='category'},{k:v for k,v in before.items() if k!='category'})
  self.assertEqual(len(changes),int(old!=new))
 def test_ruler_consistent_across_wrong_initial_categories(self):
  for category in ['unknown','stationery','other','electronics']:
   with self.subTest(category=category):self.check('金属直尺',category,'tools')
 def test_measuring_cup_is_container(self):self.check('量杯组','tools','containers')
 def test_annotated_vessel_name_kept(self):self.check('有刻度玻璃量壶','tools','containers')
 def test_drawing_template_ruler(self):self.check('绘图模板尺','stationery','tools')
 def test_null_name_not_guessed(self):self.check(None,'unknown','unknown')
 def test_cup_rack_is_not_a_vessel(self):self.check('量杯架','other','other')
 def test_clock_shape_is_not_a_vessel(self):self.check('量杯形时钟','other','other')
 def test_trophy_is_not_measuring_vessel(self):self.check('奖杯','other','other')
 def test_cleaning_brush_not_vessel(self):self.check('量杯清洁刷','tools','tools')
 def test_ruler_storage_box_not_tool(self):self.check('卷尺收纳盒','containers','containers')
 def test_picture_of_ruler_not_tool(self):self.check('直尺图片','stationery','stationery')
 def test_book_not_tool(self):self.check('画尺子的书','stationery','stationery')
 def test_dimension_label_not_ruler(self):self.check('电视尺寸标签','stationery','stationery')
 def test_already_normalized_no_audit_noise(self):self.check('量杯','containers','containers')
 def test_idempotent_and_audit_includes_original_category(self):
  i=self.item('直尺');first=server.normalize_scene_categories([i]);self.assertEqual(first,[dict(id='draft-1',name='直尺',**{'from':'stationery'},to='tools',rule='ruler-v1')]);self.assertEqual(server.normalize_scene_categories([i]),[])
 def test_extraction_returns_audited_category_without_losing_evidence(self):
  before=self.item('量杯组','tools');value={'items':[before],'sceneNotes':[]}
  with patch.object(server,'ollama_json',return_value={'message':{'content':json.dumps(value)},'done_reason':'stop'}),patch.object(server,'detector_hints',return_value={'used':False,'proposals':[]}):
   out=server.extract('scene',{'image':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ3sAAAAASUVORK5CYII='})
  after=out['data']['items'][0]
  self.assertEqual(after['category'],'containers');self.assertEqual(after['name'],before['name']);self.assertEqual(after['bbox'],before['bbox']);self.assertEqual(after['uncertainties'],before['uncertainties']);self.assertIsNone(after['visibleQuantity'])
  self.assertEqual(out['categoryNormalization']['changes'][0]['from'],'tools');self.assertTrue(out['requiresHumanConfirmation']);self.assertNotIn('approved',after)
if __name__=='__main__':unittest.main()
