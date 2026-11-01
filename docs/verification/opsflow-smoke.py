import hashlib, json, shutil, subprocess, tempfile
from pathlib import Path

source = Path(__file__).resolve().parents[2]
report = []
for product in ('codex', 'claude-code'):
    with tempfile.TemporaryDirectory(prefix='koto-opsflow-smoke-') as scratch:
        base = Path(scratch)
        dist = base / 'plugin'
        shutil.copytree(source / 'dist' / product / 'koto', dist)
        root = base / 'workspace'
        root.mkdir()
        sequence = 0
        def cli(tool, command, **options):
            payload = dict(command=command, root=str(root), project='default', **options)
            run = subprocess.run(['bun', str(dist / 'cli' / tool / (tool + '.ts')), '--input-json', json.dumps(payload)], cwd=base, capture_output=True, text=True)
            assert run.returncode == 0, (tool, command, run.stdout, run.stderr)
            result = json.loads(run.stdout)
            assert result['ok'], result
            return result['data']
        def snapshot():
            return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
        def task():
            return cli('tasks', ['task', 'show', 'ops-smoke'])['task']
        def mutate(command, **options):
            global sequence
            sequence += 1
            if command[:2] != ['task', 'add']:
                options['ifVersion'] = task()['version']
            return cli('tasks', command, operationId='smoke-' + str(sequence), **options)
        cli('memory', ['setup'])
        for scope in ('shared', 'dev', 'ops'):
            cli('memory', ['create', 'knowledge/' + scope], metadata=dict(type='knowledge', scope=scope, title='Smoke ' + scope, description='Mock operation knowledge'), body='Local mock only.')
        runbook = 'procedures/mock-operation'
        cli('memory', ['create', runbook], metadata=dict(type='procedure', scope='ops', title='Mock operation', description='Increment once; confirm actual count'), body='Verify target count is zero. Increment once. Success: count equals one. If result unknown, read count before retry.')
        before = snapshot()
        found = cli('memory', ['search'], scope='ops')
        assert {x['concept_id'] for x in found} == {'knowledge/shared', 'knowledge/ops', runbook}
        saved_runbook = cli('memory', ['show', runbook])
        assert snapshot() == before
        assert not (root / '.space/default/tasks').exists()
        assert cli('memory', ['usage', 'list'])['total'] == 0
        cli('tasks', ['setup'])
        description = '作業の種類：運用\n継続先：opsflow\n対象：ローカル模擬カウンター\n手順：' + runbook + '@' + saved_runbook['content_hash'] + '\n完了条件：count=1を実状態で確認'
        mutate(['task', 'add', 'ops-smoke'], title='Mock operation', description=description)
        mutate(['task', 'start', 'ops-smoke'])
        cli('memory', ['show', runbook], recordUsage=True, usageSource='opsflow', taskId='ops-smoke')
        target = root / 'mock-system.json'
        target.write_text(json.dumps(dict(count=0)))
        target.write_text(json.dumps(dict(count=1)))
        mutate(['checkpoint', 'save', 'ops-smoke', 'unknown-result'], summary='操作を送信。結果確認前に中断。手順=' + saved_runbook['content_hash'], next='継続先：opsflow。実状態を読み、実行済みなら繰り返さない')
        mutate(['task', 'set', 'ops-smoke'], state='paused', reason='結果確認前の中断', next='実状態を確認')
        before = snapshot()
        paused = task()
        checkpoint = cli('tasks', ['checkpoint', 'show', 'ops-smoke', 'unknown-result'])
        assert 'opsflow' in json.dumps(checkpoint, ensure_ascii=False)
        observed = json.loads(target.read_text())
        assert observed['count'] == 1
        assert paused['state'] == 'paused'
        assert cli('memory', ['show', runbook])['content_hash'] == saved_runbook['content_hash']
        assert snapshot() == before
        mutate(['task', 'start', 'ops-smoke'], reason='実状態から操作済みを確認、再送不要')
        evidence = root / '.space/default/tasks/ops-smoke/verification.json'
        evidence.parent.mkdir(parents=True)
        evidence.write_text(json.dumps(dict(observed=observed, operationRepeated=False, runbookHash=saved_runbook['content_hash'])))
        mutate(['artifact', 'add', 'ops-smoke', 'verification'], ref=str(evidence.relative_to(root)), description='Actual mock counter observed once')
        mutate(['task', 'complete', 'ops-smoke'], result='実状態count=1を確認。再送なし。純粋な運用のためPRなし。')
        assert task()['state'] == 'completed'
        assert 'scope' not in task()
        assert json.loads(target.read_text())['count'] == 1
        mutate(['task', 'reopen', 'ops-smoke'], reason='別の模擬試行で手順変更と開発引継ぎを検証')
        cli('memory', ['update', runbook], ifHash=saved_runbook['content_hash'], body='Changed mock requirements: code fix then runtime confirmation.')
        changed = cli('memory', ['show', runbook])
        assert changed['content_hash'] != saved_runbook['content_hash']
        assert task()['state'] != 'completed'
        description = description.replace('作業の種類：運用', '作業の種類：運用・開発').replace('継続先：opsflow', '継続先：devlow')
        description += '\n手順の変更を検出：' + changed['content_hash'] + '\n残る完了条件：コード修正のPRマージ・検証、その後の運用確認'
        mutate(['task', 'update', 'ops-smoke'], description=description)
        mutate(['task', 'start', 'ops-smoke'])
        mutate(['checkpoint', 'save', 'ops-smoke', 'handoff'], summary='手順の変更を検出。コード変更が必要。元の運用条件は保持。', next='継続先：devlow。マージ後も運用確認までタスクを完了にしない')
        mutate(['task', 'set', 'ops-smoke'], state='waiting', reason='模擬試行終了。実際のコード修正やPRは未実施', next='コード修正・検証・マージ後にopsflowへ戻す')
        handoff = cli('tasks', ['checkpoint', 'show', 'ops-smoke', 'handoff'])
        assert 'devlow' in json.dumps(handoff, ensure_ascii=False)
        assert task()['state'] == 'waiting'
        assert '運用確認' in task()['description']
        assert len(cli('tasks', ['task', 'list'])) == 1
        usage = cli('memory', ['usage', 'list'])
        assert usage['total'] == 1
        assert usage['events'][0]['source'] == 'opsflow'
        assert usage['events'][0]['task_id'] == 'ops-smoke'
        report.append(dict(product=product, readonlyUnchanged=True, taskScopeAbsent=True, operationCount=1, pureOpsCompleted=True, changedRunbookHeld=True, sameTaskHandoff='waiting', memoryUsage=1))
print(json.dumps(report, ensure_ascii=False, indent=2))
