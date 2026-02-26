// UdpMulticastModule.cpp
//
// Implementation file for UdpMulticastModule.
//
// All method bodies are defined inline in the header via the REACT_MODULE /
// REACT_METHOD macros (header-only pattern common in React Native Windows).
// This .cpp exists to:
//   1. Pull in the precompiled header (pch.h) so the compiler emits the PCH.
//   2. Force the linker to include the module registration symbols generated
//      by the REACT_MODULE macro in UdpMulticastModule.h.
//
// If you move method bodies out of the header in the future, implement them
// here and add the corresponding extern template instantiations.

#include "pch.h"
#include "UdpMulticastModule.h"

// The REACT_MODULE macro emits a registration helper that must appear in
// exactly one translation unit.  Including the header here (after pch.h)
// satisfies that requirement for the Windows build system.
