import base64,copy,json,unittest
from unittest.mock import patch
import server
from test_server import IMAGE

def sample():
    return {'items':[
       {'id':'laptop','name':'笔记本电脑','category':'electronics','bbox':[100,100,900,900],'visibleQuantity':1,'visibleText':'','uncertainties':[]},
       {'id':'keys','name':'内置键盘','category':'electronics','bbox':[200,600,800,850],'visibleQuantity':1,'visibleText':'','uncertainties':[]}],
       'relations':[{'parentId':'laptop','childId':'keys','relation':'integrated-part','evidence':'按键面板嵌入笔记本机身，与外壳连接成一体'}],
       'sceneNotes':[]}

class SceneIntegrationTests(unittest.TestCase):
    def run_scene(self,value,assist=None):
        with patch.object(server,'detector_hints',return_value=assist or {'used':False,'proposals':[]}),patch.object(server,'ollama_json',return_value={'message':{'content':json.dumps(value)},'done_reason':'stop'}) as model:
            result=server.extract('scene',{'image':IMAGE})
            payload=model.call_args.args[1]
        return result,payload

    def test_mapping_grouping_preserves_both_sources(self):
        r,_=self.run_scene(sample())
        self.assertEqual(len(r['data']['items']),2)
        self.assertEqual(r['grouping']['proposals'][0]['parentId'],'scene-001')
        self.assertEqual(r['grouping']['proposals'][0]['childIds'],['scene-002'])
        self.assertTrue(r['grouping']['proposals'][0]['applyByDefault'])
        self.assertNotIn('relations',r['data'])

    def test_detector_proposals_are_optional_visual_hints(self):
        r,payload=self.run_scene(sample(),{'used':True,'model':'frozen','threshold':.35,'proposals':[{'name':'键盘','bbox':[1,2,3,4]}]})
        self.assertIn('可能误框',payload['messages'][1]['content'])
        self.assertTrue(r['detectorAssist']['used'])
        self.assertNotIn('proposals',r['detectorAssist'])
        self.assertTrue(r['requiresHumanConfirmation'])

    def test_external_keyboard_is_retained(self):
        d=sample();d['items'][1]['name']='外置无线键盘'
        r,_=self.run_scene(d)
        self.assertFalse(any(x['applyByDefault'] for x in r['grouping']['proposals']))
        self.assertEqual(len(r['data']['items']),2)

    def test_ambiguous_source_ids_do_not_form_groups(self):
        d=sample();d['items'][1]['id']='laptop'
        r,_=self.run_scene(d)
        self.assertEqual(r['grouping']['proposals'],[])
        self.assertEqual(len(r['data']['items']),2)

    def test_relation_cannot_smuggle_approval(self):
        d=sample();d['relations'][0]['approved']=True
        with self.assertRaises(ValueError):self.run_scene(d)

    def test_legacy_output_still_supported(self):
        d=sample();del d['relations']
        r,_=self.run_scene(d)
        self.assertEqual(r['grouping']['proposals'],[])
        self.assertEqual(len(r['data']['items']),2)

    def test_same_parent_keeps_automatic_group_and_other_source_independent(self):
        d=sample()
        d['items'].append({'id':'screen','name':'显示屏','category':'electronics',
            'bbox':[200,200,800,500],'visibleQuantity':1,'visibleText':'','uncertainties':[]})
        # Put the nonautomatic proposal first to verify priority over input order.
        d['relations'].insert(0,{'parentId':'laptop','childId':'screen',
            'relation':'integrated-part','evidence':'显示屏通过铰链与笔记本机身连接成一体'})
        d['sceneNotes']=['已有场景说明'+str(i) for i in range(12)]
        original=copy.deepcopy(d)
        r,_=self.run_scene(d)
        self.assertEqual(len(r['grouping']['proposals']),1)
        self.assertEqual(r['grouping']['proposals'][0]['childIds'],['scene-002'])
        self.assertTrue(r['grouping']['proposals'][0]['applyByDefault'])
        self.assertEqual([i['name'] for i in r['data']['items']],
            [i['name'] for i in original['items']])
        self.assertEqual([i['bbox'] for i in r['data']['items']],
            [i['bbox'] for i in original['items']])
        self.assertTrue(any('显示屏' in n and '保留独立' in n for n in r['data']['sceneNotes']))
        self.assertLessEqual(len(r['data']['sceneNotes']),12)

    def test_adapter_priority_and_no_mutation(self):
        def proposal(parent,child,relation,automatic):
            return {'parentId':parent,'childIds':[child],'relation':relation,
                'evidence':'机身边缘可见连接','applyByDefault':automatic}
        grouping={'version':1,'notes':['原有说明'],'proposals':[
            proposal('a','a-copy','same-object',False),
            proposal('a','a-part','integrated-part',False),
            proposal('b','b-part','integrated-part',False),
            proposal('b','b-auto','same-object',True)]}
        original=copy.deepcopy(grouping)
        adapted,notes=server.frontend_grouping(grouping)
        self.assertEqual(grouping,original)
        chosen={p['parentId']:p['childIds'] for p in adapted['proposals']}
        self.assertEqual(chosen,{'a':['a-part'],'b':['b-auto']})
        self.assertEqual(set(adapted),{'version','proposals'})
        self.assertTrue(any('a-copy' in n and '保留独立' in n for n in notes))
        self.assertTrue(any('b-part' in n and '保留独立' in n for n in notes))
        self.assertIn('原有说明',notes)

    def test_long_evidence_fits_frontend_utf16_limit(self):
        d=sample()
        # The final emoji straddles the JavaScript 500-code-unit boundary.
        evidence='机身连接'+('中'*495)+'😀后续说明'
        d['relations'][0]['evidence']=evidence
        r,_=self.run_scene(d)
        kept=r['grouping']['proposals'][0]['evidence']
        self.assertLessEqual(len(kept.encode('utf-16-le'))//2,500)
        self.assertTrue(evidence.startswith(kept))
        self.assertEqual(len(r['data']['items']),2)
        self.assertTrue(any('依据过长' in n for n in r['data']['sceneNotes']))

if __name__=='__main__':unittest.main()
