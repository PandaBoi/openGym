cmake_minimum_required(VERSION 3.22.1)
project(voicellm CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Build only what the JNI shim needs from llama.cpp.
set(LLAMA_BUILD_COMMON   OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL           OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP          OFF CACHE BOOL "" FORCE)   # no libomp in the NDK sysroot
set(GGML_NATIVE          OFF CACHE BOOL "" FORCE)   # cross-compile: don't probe host CPU
set(GGML_LLAMAFILE       OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS    OFF CACHE BOOL "" FORCE)

# Android 15 requires 16 KB-aligned ELF segments for native libraries.
add_link_options("-Wl,-z,max-page-size=16384" "-Wl,-z,common-page-size=16384")

add_subdirectory(llama.cpp)

add_library(voicellm SHARED voicellm.cpp)
target_link_libraries(voicellm PRIVATE llama ggml android log)
target_link_options(voicellm PRIVATE "-Wl,-z,max-page-size=16384" "-Wl,-z,common-page-size=16384")
