"""Catalog categories are stable while visual evidence and draft state remain intact."""
import copy,json,unittest
from unittest.mock import patch
import server

class CategoryNormalizationTests(unittest.TestCase):
 def item(self,name,category='stationery'):
  return {'id':'draft-1','name':name,'category':category,'bbox':[10,20,300,400],
   'visibleQuantity':None,'visibleText':'','uncertainties':['Verify the partly obscured quantity.']}
 def check(self,name,old,new):
  i=self.item(name,old);before=copy.deepcopy(i);changes=server.normalize_scene_categories([i]);self.assertEqual(i['category'],new)
  self.assertEqual({k:v for k,v in i.items() if k!='category'},{k:v for k,v in before.items() if k!='category'})
  self.assertEqual(len(changes),int(old!=new))
 def test_ruler_consistent_across_wrong_initial_categories(self):
  for category in ['unknown','stationery','other','electronics']:
   with self.subTest(category=category):self.check('Metal Ruler',category,'tools')
 def test_measuring_cup_is_container(self):self.check('measuring cup set','tools','containers')
 def test_annotated_vessel_name_kept(self):self.check('graduated glass measuring jug','tools','containers')
 def test_drawing_template_ruler(self):self.check('drawing template ruler','stationery','tools')
 def test_null_name_not_guessed(self):self.check(None,'unknown','unknown')
 def test_cup_rack_is_not_a_vessel(self):self.check('measuring cup rack','other','other')
 def test_clock_shape_is_not_a_vessel(self):self.check('measuring cup shaped clock','other','other')
 def test_trophy_is_not_measuring_vessel(self):self.check('trophy','other','other')
 def test_cleaning_brush_not_vessel(self):self.check('measuring cup cleaning brush','tools','tools')
 def test_ruler_storage_box_not_tool(self):self.check('tape measure case','containers','containers')
 def test_picture_of_ruler_not_tool(self):self.check('picture of a ruler','stationery','stationery')
 def test_book_not_tool(self):self.check('book about drawing rulers','stationery','stationery')
 def test_dimension_label_not_ruler(self):self.check('television size label','stationery','stationery')
 def test_already_normalized_no_audit_noise(self):self.check('measuring cup','containers','containers')
 def test_idempotent_and_audit_includes_original_category(self):
  i=self.item('ruler');first=server.normalize_scene_categories([i]);self.assertEqual(first,[dict(id='draft-1',name='ruler',**{'from':'stationery'},to='tools',rule='ruler-v1')]);self.assertEqual(server.normalize_scene_categories([i]),[])
 def test_extraction_returns_audited_category_without_losing_evidence(self):
  before=self.item('measuring cup set','tools');value={'items':[before],'sceneNotes':[]}
  with patch.object(server,'ollama_json',return_value={'message':{'content':json.dumps(value)},'done_reason':'stop'}),patch.object(server,'detector_hints',return_value={'used':False,'proposals':[]}):
   out=server.extract('scene',{'image':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ3sAAAAASUVORK5CYII='})
  after=out['data']['items'][0]
  self.assertEqual(after['category'],'containers');self.assertEqual(after['name'],before['name']);self.assertEqual(after['bbox'],before['bbox']);self.assertEqual(after['uncertainties'],before['uncertainties']);self.assertIsNone(after['visibleQuantity'])
  self.assertEqual(out['categoryNormalization']['changes'][0]['from'],'tools');self.assertTrue(out['requiresHumanConfirmation']);self.assertNotIn('approved',after)
if __name__=='__main__':unittest.main()
