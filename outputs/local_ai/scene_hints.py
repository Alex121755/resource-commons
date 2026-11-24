"""Optional, local-only frozen detector hints for visual scene verification.

Hints do not create cards or authorizations. A separate visual model must
inspect the entire image and may reject, revise or supplement every hint.
"""
import hashlib,json,math,os,re,subprocess,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PYTHON=ROOT.parent/'work/training/venv/bin/python'
SCRIPT=ROOT/'training/predict.py'
CHECKPOINT=ROOT/'training/ssdlite_pilot_best.pt'

def _sha256(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()

def _v1_selection(resolution):
    try:checksum=_sha256(CHECKPOINT)
    except OSError:checksum=None
    return {'version':'v1','active_model':'v1','model':'ssdlite-pilot-best',
            'checkpoint':CHECKPOINT,'checkpoint_sha256':checksum,'threshold':.35,
            'resolution':resolution}

def resolve_detector():
    """Use only an explicitly activated, verified V2; otherwise retain V1.

    Reading this function does not activate a model or modify a decision file.
    RESOURCE_DETECTOR_VERSION=v1 is an explicit rollback, even with a valid V2
    decision. The default auto setting trusts only the fields checked below.
    """
    requested=os.environ.get('RESOURCE_DETECTOR_VERSION','auto').strip().lower()
    if requested=='v1':return _v1_selection('forced-v1')
    if requested!='auto':return _v1_selection('fallback-v1-unsupported-version')
    decision_path=ROOT/'training_v2/deployment_decision.json'
    if not decision_path.is_file():return _v1_selection('default-v1')
    try:
        if decision_path.stat().st_size>65536:raise ValueError('decision too large')
        decision=json.loads(decision_path.read_text())
        if not isinstance(decision,dict) or decision.get('status')!='activated_v2' or decision.get('gate_passed') is not True or decision.get('active_model')!='v2_seed404':
            raise ValueError('decision has not activated the primary V2')
        value=decision.get('checkpoint_path')
        if not isinstance(value,str) or not value or Path(value).is_absolute() or '..' in Path(value).parts:
            raise ValueError('checkpoint must be a relative outputs path')
        checkpoint=(ROOT/value).resolve()
        runs=(ROOT/'training_v2/runs').resolve()
        if not runs.is_relative_to(ROOT.resolve()) or not checkpoint.is_relative_to(runs) or checkpoint.suffix!='.pt' or not checkpoint.is_file():
            raise ValueError('checkpoint is outside the V2 run directory or unavailable')
        checksum=decision.get('checkpoint_sha256')
        if not isinstance(checksum,str) or not re.fullmatch('[0-9a-f]{64}',checksum) or _sha256(checkpoint)!=checksum:
            raise ValueError('checkpoint hash does not match the decision')
        threshold=decision.get('threshold')
        if type(threshold) not in (int,float) or not math.isfinite(threshold) or not 0<=threshold<=1:
            raise ValueError('threshold must be a finite number in [0,1]')
        return {'version':'v2','active_model':'v2_seed404','model':'ssdlite-v2-seed404',
                'checkpoint':checkpoint,'checkpoint_sha256':checksum,'threshold':float(threshold),
                'resolution':'v2-decision-valid'}
    except (OSError,ValueError,TypeError,OverflowError):
        return _v1_selection('fallback-v1-invalid-decision')

def available(selection=None):
    selection=resolve_detector() if selection is None else selection
    return bool(selection.get('checkpoint_sha256')) and all(p.is_file() for p in [PYTHON,SCRIPT,selection['checkpoint']])

def detector_hints(image_bytes):
    if os.environ.get('RESOURCE_SCENE_HINTS','0')!='1':
        return {'used':False,'reason':'not-enabled-or-installed','proposals':[]}
    selection=resolve_detector()
    if not available(selection):return {'used':False,'reason':'not-enabled-or-installed','proposals':[]}
    metadata={key:value for key,value in selection.items() if key!='checkpoint'}
    try:
        with tempfile.TemporaryDirectory(prefix='waicy-scene-') as directory:
            folder=Path(directory);photo=folder/'input.image';out=folder/'output.json'
            photo.write_bytes(image_bytes)
            subprocess.run([str(PYTHON),str(SCRIPT),'--image',str(photo),'--out',str(out),
                            '--checkpoint',str(selection['checkpoint']),
                            '--threshold',str(selection['threshold']),'--device','cpu'],check=True,
                           stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=35)
            if _sha256(selection['checkpoint'])!=selection['checkpoint_sha256']:raise ValueError('checkpoint changed during inference')
            doc=json.loads(out.read_text())
            if not isinstance(doc,dict):raise ValueError('bad detector output object')
            values=doc.get('detectionProposals',[])
            if not isinstance(values,list) or len(values)>12:raise ValueError('bad detector output')
            proposals=[]
            for raw in values:
                if not isinstance(raw,dict) or set(raw)-{'id','label','name','category','bbox','score'}:raise ValueError('bad fields')
                box=raw.get('bbox')
                if not isinstance(box,list) or len(box)!=4 or not all(type(v) in (int,float) and 0<=v<=1000 for v in box) or not box[0]<box[2] or not box[1]<box[3]:continue
                name=raw.get('name')
                if not isinstance(name,str) or not name.strip():continue
                proposals.append({'name':name[:100],'bbox':box})
            # The unchanged CLI's `model` string is hard-coded for V1. Only its
            # detectionProposals are read; provenance comes from our resolver.
            return {'used':True,**metadata,'proposals':proposals}
    except (OSError,ValueError,TypeError,subprocess.SubprocessError):
        # No exception text or image content is exposed/logged. The full-image
        # visual model still works without this optional helper.
        return {'used':False,**metadata,'reason':'helper-unavailable','proposals':[]}
