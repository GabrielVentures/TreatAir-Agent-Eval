#include "XPLMPlugin.h"
#include "XPLMDataAccess.h"
#include "XPLMUtilities.h"
#include "XPLMProcessing.h"
#include <algorithm>
#include <cstring>
#include <string>

// Minimal setup-only bridge: load an existing situation, never save or fly.
static std::string path;
static int pending=0,status=0,sequence=0;
static XPLMDataRef pathRef,statusRef,seqRef;
static XPLMCommandRef loadCmd;
static int getInt(void *r){return *static_cast<int*>(r);}
static int getBytes(void*,void *out,int offset,int length){
    if(!out)return (int)path.size();
    if(offset<0||offset>=(int)path.size())return 0;
    int n=std::min(length,(int)path.size()-offset);
    memcpy(out,path.data()+offset,n);return n;
}
static void setBytes(void*,void *in,int offset,int length){
    if(offset!=0||length<0||length>2048){status=-2;return;}
    path.assign(static_cast<char*>(in),length);
    if(auto p=path.find('\0');p!=std::string::npos)path.resize(p);
}
static int load(XPLMCommandRef,XPLMCommandPhase phase,void*){
    if(phase==xplm_CommandBegin){pending=1;status=0;}
    return 1;
}
static float tick(float,float,int,void*){
    if(!pending)return -1;
    pending=0;
    if(path.rfind("Output/situations/",0)!=0||path.find("..")!=std::string::npos||
       path.size()<4||path.substr(path.size()-4)!=".sit"){status=-2;return -1;}
    XPLMCommandOnce(XPLMFindCommand("sim/operation/pause_on"));
    status=XPLMLoadDataFile(xplm_DataFile_Situation,path.c_str())?1:-1;
    sequence++;
    XPLMCommandOnce(XPLMFindCommand("sim/operation/pause_on"));
    return -1;
}
PLUGIN_API int XPluginStart(char *name,char *sig,char *desc){
    strcpy(name,"Agentakt Situation Loader");
    strcpy(sig,"com.agentakt.scenario.loader");
    strcpy(desc,"Setup-only loader for an existing situation; never saves or flies.");
    pathRef=XPLMRegisterDataAccessor("agentakt/scenario/load_path",xplmType_Data,1,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,getBytes,setBytes,nullptr,nullptr);
    statusRef=XPLMRegisterDataAccessor("agentakt/scenario/load_status",xplmType_Int,0,getInt,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,&status,nullptr);
    seqRef=XPLMRegisterDataAccessor("agentakt/scenario/load_sequence",xplmType_Int,0,getInt,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,&sequence,nullptr);
    loadCmd=XPLMCreateCommand("agentakt/scenario/load_situation","Load configured existing situation (setup only)");
    XPLMRegisterCommandHandler(loadCmd,load,1,nullptr);
    XPLMRegisterFlightLoopCallback(tick,-1,nullptr);
    return 1;
}
PLUGIN_API void XPluginStop(){
    XPLMUnregisterFlightLoopCallback(tick,nullptr);
    XPLMUnregisterCommandHandler(loadCmd,load,1,nullptr);
    XPLMUnregisterDataAccessor(pathRef);XPLMUnregisterDataAccessor(statusRef);XPLMUnregisterDataAccessor(seqRef);
}
PLUGIN_API int XPluginEnable(){return 1;}
PLUGIN_API void XPluginDisable(){}
PLUGIN_API void XPluginReceiveMessage(XPLMPluginID,int,void*){}
