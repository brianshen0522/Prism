from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from oauth_stress.config import load_pair_profiles, load_users


class ConfigTests(unittest.TestCase):
  def test_load_users_requires_non_empty_array(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      path = Path(tmp) / 'users.json'
      path.write_text(json.dumps([{'username': 'alice', 'password': 'secret'}]), encoding='utf-8')
      users = load_users(path)
      self.assertEqual(len(users), 1)
      self.assertEqual(users[0].username, 'alice')

  def test_load_pair_profiles_reads_object(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      path = Path(tmp) / 'profiles.json'
      path.write_text(
        json.dumps({
          'AUTH -> RESOURCE': {
            'resource_path': '/fhir/Patient',
            'bad_resource_path': '/bad',
          },
        }),
        encoding='utf-8',
      )
      profiles = load_pair_profiles(path)
      self.assertIn('AUTH -> RESOURCE', profiles)
      self.assertEqual(profiles['AUTH -> RESOURCE']['resource_path'], '/fhir/Patient')
