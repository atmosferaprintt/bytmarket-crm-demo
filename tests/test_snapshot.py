import unittest, tempfile, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from server import init_db,connect_db,save_demo_snapshot,get_demo_snapshot,SnapshotConflict,get_state
class SnapshotTest(unittest.TestCase):
 def test_snapshot_survives_reopen_and_preserves_business_database(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'crm.db';init_db(path)
   state={'products':[],'clients':[],'orders':[],'payments':[],'chats':[{'messages':['test']}],'settings':{'value':1}}
   with connect_db(path) as c:
    first=save_demo_snapshot(c,{'expected_revision':0,'state':state})
    self.assertEqual(save_demo_snapshot(c,{'expected_revision':0,'state':state}),first)
    changed={**state,'settings':{'value':2}}
    with self.assertRaises(SnapshotConflict):save_demo_snapshot(c,{'expected_revision':0,'state':changed})
    self.assertEqual(get_demo_snapshot(c)['state'],state)
    save_demo_snapshot(c,{'expected_revision':first['revision'],'state':changed})
   with connect_db(path) as c:
    self.assertEqual(get_demo_snapshot(c)['state'],changed)
    self.assertEqual(get_state(c)['products'],[])
 def test_invalid_snapshot_rejected(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'db';init_db(path)
   with connect_db(path) as c:
    with self.assertRaises(ValueError):save_demo_snapshot(c,{'expected_revision':0,'state':{}})
    self.assertEqual(get_demo_snapshot(c)['revision'],0)
if __name__=='__main__':unittest.main()
