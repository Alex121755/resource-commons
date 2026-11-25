"""Mocked helper checks; no vision model, real weights or paid API is invoked."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import scene_hints as H


class DetectorSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='waicy-helper-unit-')
        self.root=Path(self.temporary.name)/'outputs'
        self.root.mkdir()
        self.python=self.root/'test-python'
        self.script=self.root/'training/predict.py'
        self.v1=self.root/'training/ssdlite_pilot_best.pt'
        self.script.parent.mkdir()
        self.python.write_text('mocked; never executed')
        self.script.write_text('mocked; never executed')
        self.v1.write_bytes(b'synthetic-v1-checkpoint-not-a-real-model')
        self.v2=self.root/'training_v2/runs/chosen-seed404/v2_best.pt'
        self.v2.parent.mkdir(parents=True)
        self.v2.write_bytes(b'synthetic-v2-checkpoint-not-a-real-model')
        self.decision_path=self.root/'training_v2/deployment_decision.json'
        self.decision={'status':'activated_v2','gate_passed':True,'active_model':'v2_seed404',
                       'checkpoint_path':str(self.v2.relative_to(self.root)),
                       'checkpoint_sha256':H._sha256(self.v2),'threshold':.6}
        self.constants=patch.multiple(H,ROOT=self.root,PYTHON=self.python,SCRIPT=self.script,CHECKPOINT=self.v1)
        self.constants.start()
        self.environment=patch.dict(os.environ,{'RESOURCE_SCENE_HINTS':'1','RESOURCE_DETECTOR_VERSION':'auto'})
        self.environment.start()
        self.calls=[]

    def tearDown(self):
        self.environment.stop()
        self.constants.stop()
        self.temporary.cleanup()

    def write_decision(self,**changes):
        value={**self.decision,**changes}
        self.decision_path.write_text(json.dumps(value))

    def assert_v1(self,result):
        self.assertEqual(result['version'],'v1')
        self.assertEqual(result['checkpoint'],self.v1)
        self.assertEqual(result['threshold'],.35)
        self.assertEqual(result['checkpoint_sha256'],H._sha256(self.v1))

    def run_mocked_cli(self,command,**kwargs):
        self.calls.append((command,kwargs))
        output=Path(command[command.index('--out')+1])
        output.write_text(json.dumps({'model':'hard-coded-or-untrusted-cli-label',
            'threshold':.01,'checkpoint_sha256':'wrong-cli-metadata',
            'detectionProposals':[{'id':'detection-001','label':73,'name':'laptop',
                'category':'electronics','bbox':[10,20,800,900],'score':.7}]}))
        return subprocess.CompletedProcess(command,0)

    def test_default_without_decision_is_original_v1(self):
        os.environ.pop('RESOURCE_DETECTOR_VERSION',None)
        selected=H.resolve_detector()
        self.assert_v1(selected)
        self.assertEqual(selected['resolution'],'default-v1')
        self.assertTrue(H.available())

    def test_valid_v2_is_resolved_without_changing_files(self):
        self.write_decision()
        before=(self.decision_path.read_bytes(),self.v1.read_bytes(),self.v2.read_bytes())
        selected=H.resolve_detector()
        self.assertEqual(selected['version'],'v2')
        self.assertEqual(selected['active_model'],'v2_seed404')
        self.assertEqual(selected['checkpoint'],self.v2.resolve())
        self.assertEqual(selected['threshold'],.6)
        self.assertEqual(selected['checkpoint_sha256'],H._sha256(self.v2))
        self.assertEqual(before,(self.decision_path.read_bytes(),self.v1.read_bytes(),self.v2.read_bytes()))

    def test_explicit_v1_environment_overrides_valid_activation(self):
        self.write_decision()
        os.environ['RESOURCE_DETECTOR_VERSION']='v1'
        selected=H.resolve_detector()
        self.assert_v1(selected)
        self.assertEqual(selected['resolution'],'forced-v1')

    def test_unsupported_environment_does_not_force_v2(self):
        self.write_decision()
        os.environ['RESOURCE_DETECTOR_VERSION']='v2'
        self.assert_v1(H.resolve_detector())

    def test_gate_status_and_primary_model_must_all_match(self):
        for changes in ({'status':'prepared_v2'},{'gate_passed':False},{'gate_passed':1},
                        {'active_model':'v2_seed405'},{'active_model':'v1'}):
            with self.subTest(changes=changes):
                self.write_decision(**changes)
                self.assert_v1(H.resolve_detector())

    def test_bad_json_object_and_oversized_decision_fall_back(self):
        for content in ('{bad', '[]', 'null', '"activated_v2"', ' '*65537):
            with self.subTest(content=content[:20]):
                self.decision_path.write_text(content)
                self.assert_v1(H.resolve_detector())

    def test_relative_traversal_and_absolute_paths_are_rejected(self):
        outside=self.root.parent/'outside.pt'
        outside.write_bytes(self.v2.read_bytes())
        for value in ('../outside.pt',str(outside),str(self.v2.resolve()),
                      'training_v2/runs/../runs/chosen-seed404/v2_best.pt',
                      'training/ssdlite_pilot_best.pt'):
            with self.subTest(value=value):
                self.write_decision(checkpoint_path=value)
                self.assert_v1(H.resolve_detector())

    def test_symlink_escape_is_rejected_after_resolve(self):
        outside=self.root.parent/'outside.pt'
        outside.write_bytes(self.v2.read_bytes())
        link=self.v2.parent/'escape.pt'
        link.symlink_to(outside)
        self.write_decision(checkpoint_path=str(link.relative_to(self.root)))
        self.assert_v1(H.resolve_detector())

    def test_run_root_symlink_cannot_move_models_outside_outputs(self):
        runs=self.root/'training_v2/runs'
        outside=self.root.parent/'external-runs'
        runs.rename(outside)
        runs.symlink_to(outside,target_is_directory=True)
        self.write_decision()
        self.assert_v1(H.resolve_detector())

    def test_missing_checkpoint_wrong_suffix_or_hash_fall_back(self):
        for changes in ({'checkpoint_path':'training_v2/runs/missing.pt'},
                        {'checkpoint_path':'training_v2/runs/chosen-seed404'},
                        {'checkpoint_sha256':'0'*64},{'checkpoint_sha256':True},
                        {'checkpoint_sha256':'not-a-hash'}):
            with self.subTest(changes=changes):
                self.write_decision(**changes)
                self.assert_v1(H.resolve_detector())
        wrong=self.v2.with_suffix('.json')
        wrong.write_bytes(self.v2.read_bytes())
        self.write_decision(checkpoint_path=str(wrong.relative_to(self.root)))
        self.assert_v1(H.resolve_detector())

    def test_bool_nonfinite_string_and_out_of_range_thresholds_fall_back(self):
        for value in (True,False,float('nan'),float('inf'),-.01,1.01,'0.6',None,10**400):
            with self.subTest(value=str(value)[:30]):
                self.write_decision(threshold=value)
                self.assert_v1(H.resolve_detector())

    def test_boundary_thresholds_are_valid_numbers(self):
        for value in (0,1,.35):
            with self.subTest(value=value):
                self.write_decision(threshold=value)
                self.assertEqual(H.resolve_detector()['version'],'v2')

    def test_cli_uses_resolved_checkpoint_and_threshold_not_its_metadata(self):
        self.write_decision()
        with patch.object(H.subprocess,'run',side_effect=self.run_mocked_cli):
            result=H.detector_hints(b'synthetic-photo-bytes')
        command,options=self.calls[0]
        self.assertEqual(command[command.index('--checkpoint')+1],str(self.v2.resolve()))
        self.assertEqual(command[command.index('--threshold')+1],'0.6')
        self.assertEqual(command[command.index('--device')+1],'cpu')
        self.assertEqual(options['timeout'],35)
        self.assertTrue(result['used'])
        self.assertEqual(result['model'],'ssdlite-v2-seed404')
        self.assertEqual(result['version'],'v2')
        self.assertEqual(result['checkpoint_sha256'],H._sha256(self.v2))
        self.assertEqual(result['threshold'],.6)
        self.assertEqual(result['proposals'],[{'name':'laptop','bbox':[10,20,800,900]}])
        self.assertNotIn('checkpoint',result)

    def test_v1_cli_still_uses_original_threshold_and_reports_hash(self):
        with patch.object(H.subprocess,'run',side_effect=self.run_mocked_cli):
            result=H.detector_hints(b'synthetic')
        command,_=self.calls[0]
        self.assertEqual(command[command.index('--checkpoint')+1],str(self.v1))
        self.assertEqual(command[command.index('--threshold')+1],'0.35')
        self.assertEqual(result['model'],'ssdlite-pilot-best')
        self.assertEqual(result['version'],'v1')
        self.assertEqual(result['checkpoint_sha256'],H._sha256(self.v1))

    def test_disabled_or_uninstalled_helper_never_executes(self):
        with patch.object(H.subprocess,'run',side_effect=self.fail):
            os.environ['RESOURCE_SCENE_HINTS']='0'
            self.assertFalse(H.detector_hints(b'synthetic')['used'])
            os.environ['RESOURCE_SCENE_HINTS']='1'
            self.python.unlink()
            self.assertFalse(H.detector_hints(b'synthetic')['used'])

    def test_subprocess_failure_retains_unused_full_image_fallback(self):
        self.write_decision()
        secret='synthetic-photo-should-not-be-exposed'
        with patch.object(H.subprocess,'run',side_effect=subprocess.TimeoutExpired('mocked',35,output=secret)):
            result=H.detector_hints(secret.encode())
        self.assertFalse(result['used'])
        self.assertEqual(result['reason'],'helper-unavailable')
        self.assertEqual(result['proposals'],[])
        self.assertNotIn(secret,json.dumps(result))

    def test_checkpoint_mutation_during_helper_run_is_not_accepted(self):
        self.write_decision()
        def changed(command,**kwargs):
            completed=self.run_mocked_cli(command,**kwargs)
            self.v2.write_bytes(b'changed-during-inference')
            return completed
        with patch.object(H.subprocess,'run',side_effect=changed):
            result=H.detector_hints(b'synthetic')
        self.assertFalse(result['used'])

    def test_invalid_cli_json_shape_is_safe_failure(self):
        for value in ([],None,{'detectionProposals':'wrong'},
                      {'detectionProposals':[{}]*13},
                      {'detectionProposals':[{'name':'bad','approved':True}]}):
            def invalid(command,**kwargs):
                Path(command[command.index('--out')+1]).write_text(json.dumps(value))
            with self.subTest(value=str(value)[:30]),patch.object(H.subprocess,'run',side_effect=invalid):
                self.assertFalse(H.detector_hints(b'synthetic')['used'])

    def test_helper_failure_still_calls_whole_image_model_entry(self):
        import server
        from test_server import IMAGE,scene_sample
        with patch.object(server,'detector_hints',H.detector_hints),patch.object(
                H.subprocess,'run',side_effect=subprocess.TimeoutExpired('mocked',35)),patch.object(
                server,'ollama_json',return_value={'message':{'content':json.dumps(scene_sample())},'done_reason':'stop'}) as visual:
            result=server.extract('scene',{'image':IMAGE})
        self.assertEqual(visual.call_count,1)
        self.assertFalse(result['detectorAssist']['used'])
        self.assertEqual(len(result['data']['items']),2)
        self.assertIn('images',visual.call_args.args[1]['messages'][1])

    def test_server_trace_marks_v2_without_changing_v1_display(self):
        import server
        from test_server import IMAGE,scene_sample
        for version in ('v1','v2'):
            assistance={'used':True,'version':version,'threshold':.6,
                        'checkpoint_sha256':'a'*64,'proposals':[]}
            with patch.object(server,'detector_hints',return_value=assistance),patch.object(
                    server,'ollama_json',return_value={'message':{'content':json.dumps(scene_sample())},'done_reason':'stop'}):
                result=server.extract('scene',{'image':IMAGE})
            self.assertEqual(result['detectorAssist']['version'],version)
            self.assertEqual(result['detectorAssist']['checkpoint_sha256'],'a'*64)
            self.assertEqual('V2' in result['model'],version=='v2')


if __name__=='__main__':unittest.main()
