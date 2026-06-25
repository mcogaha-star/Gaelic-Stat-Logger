import React from 'react';
import { Navigate } from 'react-router-dom';

import { createPageUrl } from '@/utils';

export default function About() {
  return <Navigate to={createPageUrl('Settings')} replace />;
}
