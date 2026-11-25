import base64,copy,io,json,struct,unittest,zlib
from unittest.mock import Mock
from component_review import review,candidate_pairs,review_images
from server import validate_schema

def items():return [
 {'id':'p','name':'laptop','bbox':[0,0,1000,1000],'visibleQuantity':1,'uncertainties':[]},
 {'id':'c','name':'external keyboard','bbox':[200,650,800,900],'visibleQuantity':1,'uncertainties':[]}]

def answer(relation='integrated-part',parent='p',child='c'):
    return {'message':{'content':json.dumps({'relations':[{'parentId':parent,'childId':child,'relation':relation,'evidence':'The key panel is embedded in the base, connected to the chassis edge and hinge.'}]})},'done_reason':'stop'}

class ReviewTests(unittest.TestCase):
    def test_focused_image_review_can_correct_initial_label(self):
        data=items();call=Mock(return_value=answer())
        relations,audit=review(data,'BASE64','model',call,validate_schema)
        self.assertEqual(data[1]['name'],'Built-in keyboard candidate')
        self.assertIn('external keyboard',data[1]['uncertainties'][0])
        self.assertEqual(data[1]['bbox'],[200,650,800,900])
        self.assertEqual(relations[0]['relation'],'integrated-part')
        self.assertEqual(audit['originalNames'][0]['name'],'external keyboard')
        self.assertEqual(call.call_args.args[1]['messages'][1]['images'],['BASE64'])

    def test_separate_overlapping_keyboard_remains_independent(self):
        data=items();r,a=review(data,'base','model',Mock(return_value=answer('separate')),validate_schema)
        self.assertEqual(r[0]['relation'],'separate');self.assertEqual(data[1]['name'],'external keyboard')

    def test_unknown_or_failed_review_does_not_force_merge(self):
        data=items();r,a=review(data,'base','model',Mock(side_effect=OSError('offline')),validate_schema)
        self.assertEqual(r[0]['relation'],'uncertain');self.assertEqual(data[1]['name'],'external keyboard')

    def test_bad_ids_and_duplicate_answers_become_unknown(self):
        data=items();r,_=review(data,'base','model',Mock(return_value=answer(parent='invented')),validate_schema)
        self.assertEqual(r[0]['relation'],'uncertain')
        d=answer();value=json.loads(d['message']['content']);value['relations']*=2;d['message']['content']=json.dumps(value)
        r,_=review(items(),'base','model',Mock(return_value=d),validate_schema)
        self.assertEqual(r[0]['relation'],'uncertain')

    def test_deadline_skips_extra_inference_and_preserves_candidates(self):
        call=Mock();r,a=review(items(),'base','model',call,validate_schema,timeout=2)
        call.assert_not_called();self.assertEqual(r[0]['relation'],'uncertain')

    def test_no_keyboard_pair_does_not_call_model(self):
        call=Mock();r,a=review(items()[:1],'base','model',call,validate_schema)
        call.assert_not_called();self.assertEqual(r,[])

    def test_far_keyboard_does_not_need_part_review(self):
        data=items();data[0]['bbox']=[0,0,300,300]
        self.assertEqual(candidate_pairs(data),[])

    def test_authority_field_in_visual_reply_is_rejected(self):
        data=items();d=answer();value=json.loads(d['message']['content']);value['relations'][0]['approved']=True;d['message']['content']=json.dumps(value)
        r,_=review(data,'base','model',Mock(return_value=d),validate_schema)
        self.assertEqual(r[0]['relation'],'uncertain')

    def test_context_crop_is_a_separate_annotated_input_not_a_source_edit(self):
        from PIL import Image
        photo=Image.new('RGB',(160,120),'white');buffer=io.BytesIO();photo.save(buffer,format='JPEG')
        original=base64.b64encode(buffer.getvalue()).decode();data=items();before=copy.deepcopy(data)
        images,rows=review_images(candidate_pairs(data),original)
        self.assertEqual(data,before);self.assertEqual(images[0],original)
        self.assertEqual(len(images),2);self.assertEqual(rows[0]['cropImage'],2)
        crop=Image.open(io.BytesIO(base64.b64decode(images[1])))
        self.assertLessEqual(max(crop.size),960)
        self.assertTrue(any(r>g+40 and r>b+40 for r,g,b in list(crop.get_flattened_data())))
        self.assertTrue(all(pixel==(255,255,255) for pixel in list(photo.get_flattened_data())))

    def test_crop_budget_is_bounded_and_bad_image_keeps_full_image(self):
        from PIL import Image
        buffer=io.BytesIO();Image.new('RGB',(80,60),'white').save(buffer,format='JPEG')
        pairs=candidate_pairs(items())*6
        images,rows=review_images(pairs,base64.b64encode(buffer.getvalue()).decode())
        self.assertEqual(len(images),4);self.assertEqual(len(rows),6)
        self.assertNotIn('cropImage',rows[3])
        images,rows=review_images(pairs,'invalid')
        self.assertEqual(images,['invalid']);self.assertTrue(all('cropImage' not in r for r in rows))

    def test_oversized_image_header_falls_back_before_pixel_decode(self):
        from PIL import Image
        buffer=io.BytesIO();Image.new('RGB',(1,1)).save(buffer,format='PNG');raw=bytearray(buffer.getvalue())
        raw[16:24]=struct.pack('>II',20000,20000)
        raw[29:33]=struct.pack('>I',zlib.crc32(raw[12:29])&0xffffffff)
        original=base64.b64encode(raw).decode()
        images,rows=review_images(candidate_pairs(items()),original)
        self.assertEqual(images,[original]);self.assertNotIn('cropImage',rows[0])

if __name__=='__main__':unittest.main()
